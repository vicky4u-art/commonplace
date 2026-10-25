-- Commonplace: ownership is always derived from auth.uid(), never a client argument.
-- Data JSON preserves original fields/timestamps exactly; generated columns and FKs
-- make relationships relational, enforce ownership, and allow ordinary SQL queries.
create table public.cp_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table public.cp_projects (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null, data jsonb not null check (jsonb_typeof(data)='object' and data->>'id'=id),
  name text generated always as (data->>'name') stored,
  created_at text generated always as (data->>'createdAt') stored,
  updated_at timestamptz not null default now(), primary key(user_id,id)
);
create table public.cp_audio (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null, data jsonb not null check (data->>'id'=id),
  path text generated always as (data->>'path') stored,
  sha256 text generated always as (data->>'sha256') stored,
  updated_at timestamptz not null default now(), primary key(user_id,id),
  check (data->>'path' like user_id::text || '/%')
);
create table public.cp_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null, data jsonb not null check (data->>'id'=id),
  title text generated always as (data->>'title') stored,
  content text generated always as (data->>'content') stored,
  project_id text generated always as (nullif(data->>'projectId','')) stored,
  audio_id text generated always as (nullif(data->>'audioId','')) stored,
  created_at text generated always as (data->>'createdAt') stored,
  updated_at timestamptz not null default now(), primary key(user_id,id),
  foreign key(user_id,project_id) references public.cp_projects(user_id,id),
  foreign key(user_id,audio_id) references public.cp_audio(user_id,id)
);
create table public.cp_tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null, data jsonb not null check (data->>'id'=id),
  title text generated always as (data->>'title') stored,
  done boolean generated always as ((data->>'done')::boolean) stored,
  project_id text generated always as (nullif(data->>'projectId','')) stored,
  created_at text generated always as (data->>'createdAt') stored,
  updated_at timestamptz not null default now(), primary key(user_id,id),
  foreign key(user_id,project_id) references public.cp_projects(user_id,id)
);
create table public.cp_subtasks (
  user_id uuid not null, task_id text not null, id text not null,
  data jsonb not null check (data->>'id'=id), position integer not null,
  done boolean generated always as ((data->>'done')::boolean) stored,
  updated_at timestamptz not null default now(), primary key(user_id,task_id,id),
  foreign key(user_id,task_id) references public.cp_tasks(user_id,id) on delete cascade
);
create table public.cp_task_notes (
  user_id uuid not null, task_id text not null, note_id text not null,
  updated_at timestamptz not null default now(), primary key(user_id,task_id,note_id),
  foreign key(user_id,task_id) references public.cp_tasks(user_id,id) on delete cascade,
  foreign key(user_id,note_id) references public.cp_notes(user_id,id) on delete cascade
);
create index cp_tasks_project on public.cp_tasks(user_id,project_id);
create index cp_notes_project on public.cp_notes(user_id,project_id);
create index cp_notes_audio on public.cp_notes(user_id,audio_id);
create index cp_task_notes_note on public.cp_task_notes(user_id,note_id);
-- RLS for every table and every operation; owner cannot be changed to another user.
do $$ declare t text; begin
  foreach t in array array['cp_workspaces','cp_projects','cp_audio','cp_notes','cp_tasks','cp_subtasks','cp_task_notes'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy owner_only on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
    execute format('revoke all on public.%I from anon',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  end loop;
end $$;
-- Read all rows as one statement/snapshot, avoiding REST's default 1000-row page limit.
create function public.cp_read() returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('revision',coalesce((select revision from public.cp_workspaces where user_id=auth.uid()),0),
    'state',jsonb_build_object('version',1,
    'projects',coalesce((select jsonb_agg(data order by id) from public.cp_projects where user_id=auth.uid()),'[]'::jsonb),
    'notes',coalesce((select jsonb_agg(data order by id) from public.cp_notes where user_id=auth.uid()),'[]'::jsonb),
    'attachments',coalesce((select jsonb_agg(data order by id) from public.cp_audio where user_id=auth.uid()),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(t.data || jsonb_build_object(
      'subtasks',coalesce((select jsonb_agg(s.data order by s.position) from public.cp_subtasks s where s.user_id=t.user_id and s.task_id=t.id),'[]'::jsonb),
      'noteIds',coalesce((select jsonb_agg(l.note_id order by l.note_id) from public.cp_task_notes l where l.user_id=t.user_id and l.task_id=t.id),'[]'::jsonb)) order by t.id)
      from public.cp_tasks t where t.user_id=auth.uid()),'[]'::jsonb)))
$$;
-- An atomic compare-and-swap transaction. No partial task/note/link saves.
create function public.cp_commit(expected_revision bigint, document jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid := auth.uid(); current_revision bigint; t jsonb; s jsonb; n jsonb; pos integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(document->'projects') is distinct from 'array' or jsonb_typeof(document->'tasks') is distinct from 'array'
    or jsonb_typeof(document->'notes') is distinct from 'array' or jsonb_typeof(document->'attachments') is distinct from 'array'
    then raise exception 'Invalid document'; end if;
  insert into public.cp_workspaces(user_id) values(uid) on conflict do nothing;
  select revision into current_revision from public.cp_workspaces where user_id=uid for update;
  if current_revision <> expected_revision then return jsonb_build_object('conflict',true); end if;
  -- All deletes/inserts roll back together on malformed data, FK errors or network cancellation.
  delete from public.cp_task_notes where user_id=uid;
  delete from public.cp_subtasks where user_id=uid;
  delete from public.cp_tasks where user_id=uid;
  delete from public.cp_notes where user_id=uid;
  delete from public.cp_projects where user_id=uid;
  delete from public.cp_audio where user_id=uid;
  insert into public.cp_projects(user_id,id,data) select uid,x->>'id',x from jsonb_array_elements(document->'projects') x;
  insert into public.cp_audio(user_id,id,data) select uid,x->>'id',x from jsonb_array_elements(document->'attachments') x;
  insert into public.cp_notes(user_id,id,data) select uid,x->>'id',x from jsonb_array_elements(document->'notes') x;
  for t in select value from jsonb_array_elements(document->'tasks') loop
    insert into public.cp_tasks(user_id,id,data) values(uid,t->>'id',t-'subtasks'-'noteIds');
    pos:=0;
    for s in select value from jsonb_array_elements(t->'subtasks') loop
      insert into public.cp_subtasks(user_id,task_id,id,data,position) values(uid,t->>'id',s->>'id',s,pos);pos:=pos+1;
    end loop;
    for n in select value from jsonb_array_elements(t->'noteIds') loop
      insert into public.cp_task_notes(user_id,task_id,note_id) values(uid,t->>'id',n#>>'{}');
    end loop;
  end loop;
  update public.cp_workspaces set revision=revision+1,updated_at=now() where user_id=uid;
  return public.cp_read();
end $$;
revoke all on function public.cp_read() from public,anon;
revoke all on function public.cp_commit(bigint,jsonb) from public,anon;
grant execute on function public.cp_read(), public.cp_commit(bigint,jsonb) to authenticated;
-- Immutable, content-addressed audio objects. No public URLs or overwrites.
insert into storage.buckets(id,name,public,file_size_limit) values('commonplace-audio','commonplace-audio',false,52428800);
create policy cp_audio_read on storage.objects for select to authenticated
  using (bucket_id='commonplace-audio' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy cp_audio_insert on storage.objects for insert to authenticated
  with check (bucket_id='commonplace-audio' and (storage.foldername(name))[1]=(select auth.uid())::text);
