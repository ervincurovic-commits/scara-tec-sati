-- Scara-Tec hours tracker: relational schema with row level security.
-- Replaces the single JSON row in public.app_state.

create type public.user_role as enum ('admin', 'baulajter', 'radnik');

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 120),
  username   text not null check (username ~ '^[a-z0-9._-]{2,40}$'),
  role       public.user_role not null default 'radnik',
  email      text not null default '' check (length(email) <= 200),
  phone      text not null default '' check (length(phone) <= 60),
  created_at timestamptz not null default now()
);
create unique index profiles_username_key on public.profiles (username);

create table public.sites (
  id           uuid primary key default gen_random_uuid(),
  location     text not null check (length(trim(location)) between 1 and 200),
  company      text not null check (length(trim(company)) between 1 and 200),
  baulajter_id uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.site_members (
  site_id uuid not null references public.sites (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (site_id, user_id)
);
create index site_members_user_idx on public.site_members (user_id);

create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) between 1 and 200),
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.site_projects (
  site_id    uuid not null references public.sites (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  primary key (site_id, project_id)
);

-- The site leader's own working list of people shown in the weekly table.
create table public.bau_lists (
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  site_id    uuid not null references public.sites (id) on delete cascade,
  member_ids uuid[] not null default '{}',
  primary key (owner_id, site_id)
);

create table public.time_entries (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  work_date    date not null,
  project_id   uuid references public.projects (id) on delete restrict,
  work_hours   numeric(4, 2) not null default 0 check (work_hours between 0 and 24),
  travel_hours numeric(4, 2) not null default 0 check (travel_hours between 0 and 24),
  updated_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (user_id, work_date)
);
create index time_entries_date_idx on public.time_entries (work_date);
create index time_entries_project_idx on public.time_entries (project_id, work_date);

-- One row per project and ISO week (week_start is always a Monday).
create table public.signatures (
  project_id       uuid not null references public.projects (id) on delete restrict,
  week_start       date not null check (extract(isodow from week_start) = 1),
  user_signature   text check (user_signature is null or (user_signature like 'data:image/png;base64,%' and length(user_signature) <= 400000)),
  user_signed_by   uuid references public.profiles (id) on delete set null,
  user_signed_name text not null default '',
  user_signed_at   timestamptz,
  kunde_signature  text check (kunde_signature is null or (kunde_signature like 'data:image/png;base64,%' and length(kunde_signature) <= 400000)),
  kunde_signed_at  timestamptz,
  kunde_lang       text check (kunde_lang is null or kunde_lang in ('de', 'sl')),
  primary key (project_id, week_start),
  constraint kunde_needs_user_signature check (kunde_signature is null or user_signature is not null)
);

-- ---------------------------------------------------------------- helpers
-- Security definer so policies can read role and membership without recursion.

create function public.my_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'admin', false);
$$;

create function public.is_leader() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'baulajter', false);
$$;

-- Sites the caller leads or belongs to.
create function public.my_site_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.sites s where s.baulajter_id = (select auth.uid())
  union
  select m.site_id from public.site_members m where m.user_id = (select auth.uid());
$$;

-- A site leader may enter hours for themselves and for people on their sites.
create function public.can_manage_user(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
      or (public.is_leader() and (
            target = (select auth.uid())
            or exists (
                 select 1 from public.site_members m
                 where m.user_id = target and m.site_id in (select public.my_site_ids())
               )
            or exists (
                 select 1 from public.sites s
                 where s.baulajter_id = target and s.id in (select public.my_site_ids())
               )
         ));
$$;

create function public.project_on_my_sites(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.site_projects sp
    where sp.project_id = pid and sp.site_id in (select public.my_site_ids())
  );
$$;

-- ---------------------------------------------------------------- triggers

-- Hours of a project week are frozen once the client has signed it.
create function public.time_entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  locked boolean;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.project_id is not null then
    select exists (
      select 1 from public.signatures s
      where s.project_id = old.project_id
        and s.week_start = date_trunc('week', old.work_date)::date
        and s.kunde_signature is not null
    ) into locked;
    if locked then
      raise exception 'LOCKED_BY_CLIENT_SIGNATURE' using errcode = 'P0001';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.project_id is not null then
      select exists (
        select 1 from public.signatures s
        where s.project_id = new.project_id
          and s.week_start = date_trunc('week', new.work_date)::date
          and s.kunde_signature is not null
      ) into locked;
      if locked then
        raise exception 'LOCKED_BY_CLIENT_SIGNATURE' using errcode = 'P0001';
      end if;
    end if;
    new.updated_by := (select auth.uid());
    new.updated_at := now();
    return new;
  end if;

  return old;
end;
$$;

create trigger time_entries_guard
  before insert or update or delete on public.time_entries
  for each row execute function public.time_entries_guard();

-- After the client signature only an administrator may change or remove it.
create function public.signatures_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.kunde_signature is not null and not public.is_admin() then
    raise exception 'SIGNED_BY_CLIENT' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger signatures_guard
  before update or delete on public.signatures
  for each row execute function public.signatures_guard();

-- ---------------------------------------------------------------- row level security

alter table public.profiles      enable row level security;
alter table public.sites         enable row level security;
alter table public.site_members  enable row level security;
alter table public.projects      enable row level security;
alter table public.site_projects enable row level security;
alter table public.bau_lists     enable row level security;
alter table public.time_entries  enable row level security;
alter table public.signatures    enable row level security;

-- profiles: the staff directory is visible to every signed in employee.
-- Accounts are created and removed only by the admin-users edge function.
create policy profiles_select on public.profiles for select to authenticated
  using (public.my_role() is not null);
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- sites
create policy sites_select on public.sites for select to authenticated
  using (public.is_admin() or id in (select public.my_site_ids()));
create policy sites_write_admin on public.sites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- site_members
create policy site_members_select on public.site_members for select to authenticated
  using (public.is_admin() or site_id in (select public.my_site_ids()));
create policy site_members_write_admin on public.site_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- projects
create policy projects_select on public.projects for select to authenticated
  using (public.my_role() is not null);
create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_admin() or public.is_leader());
create policy projects_update on public.projects for update to authenticated
  using (public.is_admin() or public.is_leader())
  with check (public.is_admin() or public.is_leader());

-- site_projects
create policy site_projects_select on public.site_projects for select to authenticated
  using (public.my_role() is not null);
create policy site_projects_insert on public.site_projects for insert to authenticated
  with check (public.is_admin() or (public.is_leader() and site_id in (select public.my_site_ids())));
create policy site_projects_delete_admin on public.site_projects for delete to authenticated
  using (public.is_admin());

-- bau_lists: private to the site leader who owns the list.
create policy bau_lists_owner on public.bau_lists for all to authenticated
  using (owner_id = (select auth.uid()) and (public.is_leader() or public.is_admin()))
  with check (owner_id = (select auth.uid()) and (public.is_leader() or public.is_admin())
              and site_id in (select public.my_site_ids()));

-- time_entries
create policy time_entries_select on public.time_entries for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_manage_user(user_id)
    or (public.is_leader() and project_id is not null and public.project_on_my_sites(project_id))
  );
create policy time_entries_insert on public.time_entries for insert to authenticated
  with check (public.can_manage_user(user_id));
create policy time_entries_update on public.time_entries for update to authenticated
  using (public.can_manage_user(user_id)) with check (public.can_manage_user(user_id));
create policy time_entries_delete on public.time_entries for delete to authenticated
  using (public.can_manage_user(user_id));

-- signatures
create policy signatures_select on public.signatures for select to authenticated
  using (public.is_admin() or public.is_leader());
create policy signatures_insert on public.signatures for insert to authenticated
  with check (public.is_admin() or public.is_leader());
create policy signatures_update on public.signatures for update to authenticated
  using (public.is_admin() or public.is_leader())
  with check (public.is_admin() or public.is_leader());
create policy signatures_delete_admin on public.signatures for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------- grants
-- Nothing for anon: the app is unusable without a session.

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;

grant usage on schema public to authenticated, service_role;

grant select, update                 on public.profiles      to authenticated;
grant select, insert, update, delete on public.sites         to authenticated;
grant select, insert, delete         on public.site_members  to authenticated;
grant select, insert, update         on public.projects      to authenticated;
grant select, insert, delete         on public.site_projects to authenticated;
grant select, insert, update, delete on public.bau_lists     to authenticated;
grant select, insert, update, delete on public.time_entries  to authenticated;
grant select, insert, update, delete on public.signatures    to authenticated;

grant all on all tables in schema public to service_role;

grant execute on function public.my_role()                 to authenticated, service_role;
grant execute on function public.is_admin()                to authenticated, service_role;
grant execute on function public.is_leader()               to authenticated, service_role;
grant execute on function public.my_site_ids()             to authenticated, service_role;
grant execute on function public.can_manage_user(uuid)     to authenticated, service_role;
grant execute on function public.project_on_my_sites(uuid) to authenticated, service_role;
