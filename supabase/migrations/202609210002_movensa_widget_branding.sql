update public.webchatbot_widgets
set brand_text = 'Grupo Movensa', updated_at = now()
where brand_text ~* '(ULU|CNET)';
