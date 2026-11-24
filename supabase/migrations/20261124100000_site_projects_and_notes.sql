-- Projects belong to one construction site, and every site gets notes.

-- ---------------------------------------------------------------- projects per site
-- Two sites may now run a project with the same name. Each site leader creates
-- their own project row, linked only to their site (see site_projects_insert).
alter table public.projects drop constraint if exists projects_name_key;

-- ---------------------------------------------------------------- notes

create table public.site_notes (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  author_name text not null default '',
  body       text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_name text not null default '',
  updated_at timestamptz not null default now()
);
create index site_notes_site_idx on public.site_notes (site_id, created_at);

-- Author, editor and times always come from the session, never from the client.
create function public.site_notes_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text;
begin
  select name into who from public.profiles where id = (select auth.uid());
  if tg_op = 'INSERT' then
    new.author_id := (select auth.uid());
    new.author_name := coalesce(who, '');
    new.created_at := now();
  else
    new.site_id := old.site_id;
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.created_at := old.created_at;
  end if;
  new.updated_by := (select auth.uid());
  new.updated_name := coalesce(who, '');
  new.updated_at := now();
  return new;
end;
$$;

create trigger site_notes_stamp
  before insert or update on public.site_notes
  for each row execute function public.site_notes_stamp();

alter table public.site_notes enable row level security;

-- The administrator sees and edits every note. A site leader sees the notes of
-- their own sites, adds new ones and edits or removes the ones they wrote.
create policy site_notes_select on public.site_notes for select to authenticated
  using (public.is_admin() or (public.is_leader() and site_id in (select public.my_site_ids())));
create policy site_notes_insert on public.site_notes for insert to authenticated
  with check (public.is_admin() or (public.is_leader() and site_id in (select public.my_site_ids())));
create policy site_notes_update on public.site_notes for update to authenticated
  using (public.is_admin() or (public.is_leader() and author_id = (select auth.uid()) and site_id in (select public.my_site_ids())))
  with check (public.is_admin() or (public.is_leader() and site_id in (select public.my_site_ids())));
create policy site_notes_delete on public.site_notes for delete to authenticated
  using (public.is_admin() or (public.is_leader() and author_id = (select auth.uid()) and site_id in (select public.my_site_ids())));

revoke all on public.site_notes from anon;
grant select, insert, update, delete on public.site_notes to authenticated;
grant all on public.site_notes to service_role;
revoke all on function public.site_notes_stamp() from public, anon;
