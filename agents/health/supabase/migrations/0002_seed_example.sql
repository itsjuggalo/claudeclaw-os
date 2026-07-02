-- Health OS, EXAMPLE seed (placeholder values, replace with your own).
-- Shows the shape of the goals + context rows the coach reads. NONE of these
-- numbers are real; set yours from your own labs, body composition, and location.

insert into goals (metric, start_value, target_value, target_date, current_value, notes) values
  ('body_weight_kg', 100.0, 80.0,  null, 100.0, 'EXAMPLE. Your single organizing goal, e.g. fat loss with full muscle retention.'),
  ('ldl',            150.0, 100.0, null, 150.0, 'EXAMPLE mg/dL. Physician-set target.'),
  ('vitamin_d',      20.0,  60.0,  null, 20.0,  'EXAMPLE ng/mL. Target band 50-70.'),
  ('homa_ir',        2.0,   1.5,   null, 2.0,   'EXAMPLE HOMA2-IR. Insulin resistance lever, target under 1.5.'),
  ('bp_systolic',    null,  120.0, null, null,  'EXAMPLE. Target systolic, set from your own readings.');

insert into context (city, timezone, environment, private_chef, notes) values
  ('Your City', 'America/Toronto', 'home', false,
   'EXAMPLE. Where you are and how the coach should adapt food and job timing. Update when you travel.');
