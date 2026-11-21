-- Interne triggerfuncties zijn niet bedoeld om via de API (/rest/v1/rpc) aan te roepen.
-- (Supabase geeft nieuwe functies standaard EXECUTE voor authenticated; de kernmigratie trok dat alleen voor anon/public in.)
revoke execute on function public.handle_new_user() from authenticated, anon, public;
revoke execute on function public.check_task_assignee() from authenticated, anon, public;
revoke execute on function public.set_updated_at() from authenticated, anon, public;
