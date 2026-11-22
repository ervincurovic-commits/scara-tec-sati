-- The old app kept every user, plaintext password and hour in one publicly
-- readable and writable JSON row. Remove it so that data is no longer exposed.
drop table if exists public.app_state;
