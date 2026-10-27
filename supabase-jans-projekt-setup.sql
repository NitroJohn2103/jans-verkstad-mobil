-- Jans verkstad - Projekt & ritningar: separat privat molnlagring.
-- Engangsinstallning i Supabase Dashboard > SQL Editor.
-- Befintliga verktyg, tabeller och jans-foton berors inte.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'jans-projekt',
  'jans-projekt',
  false,
  26214400,
  array['application/json', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[]
)
on conflict (id) do nothing;

-- Bara inloggad anvandare far lasa och lagga till egna filer.
-- Varje sokvag borjar med anvandarens auth.uid().
do $setup$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='jans_projekt_own_read'
  ) then
    create policy jans_projekt_own_read
    on storage.objects
    for select
    to authenticated
    using (
      bucket_id = 'jans-projekt'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='jans_projekt_own_insert'
  ) then
    create policy jans_projekt_own_insert
    on storage.objects
    for insert
    to authenticated
    with check (
      bucket_id = 'jans-projekt'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );
  end if;
end;
$setup$;

-- Projektfilerna far inte publika URL:er.
-- Ingen generell UPDATE eller DELETE-policy ges: tidigare
-- versionskopior skyddas mot oavsiktlig overskrivning.
