-- Preserve the exact response-mode value used by the original application.
alter table public.company_ai_settings
  drop constraint if exists company_ai_settings_response_mode_check;

update public.company_ai_settings
set response_mode = 'unassigned_only'
where response_mode = 'unassigned';

alter table public.company_ai_settings
  add constraint company_ai_settings_response_mode_check
  check (response_mode in ('disabled', 'always', 'outside_business_hours', 'unassigned_only'));
