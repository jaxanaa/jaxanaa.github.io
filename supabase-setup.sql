create table if not exists public.blackjack_rooms (
  id text primary key,
  state jsonb not null,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.blackjack_rooms enable row level security;

grant select, insert, update on public.blackjack_rooms to anon;

drop policy if exists "Anyone can read blackjack rooms" on public.blackjack_rooms;
create policy "Anyone can read blackjack rooms"
  on public.blackjack_rooms for select to anon using (true);

drop policy if exists "Anyone can create blackjack rooms" on public.blackjack_rooms;
create policy "Anyone can create blackjack rooms"
  on public.blackjack_rooms for insert to anon with check (true);

drop policy if exists "Anyone can update blackjack rooms" on public.blackjack_rooms;
create policy "Anyone can update blackjack rooms"
  on public.blackjack_rooms for update to anon using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'blackjack_rooms'
  ) then
    alter publication supabase_realtime add table public.blackjack_rooms;
  end if;
end
$$;
