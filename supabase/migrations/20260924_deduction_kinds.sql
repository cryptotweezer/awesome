-- The kinds of claim, as this business actually spends.
--
-- `rags_washing` in, `travel` and `fees` out: the cloths come back every week
-- and were being filed under supplies with a note, and neither of the two that
-- left had ever been used. The list is short on purpose, so a year groups into
-- something readable and an agent cannot invent a new kind each time.
alter table awesome.tax_deductions
  drop constraint if exists tax_deductions_category_check;
alter table awesome.tax_deductions
  add constraint tax_deductions_category_check check (category in (
    'vehicle',
    'tools',
    'equipment',
    'supplies',
    'rags_washing',
    'phone_internet',
    'insurance',
    'clothing',
    'other'
  ));
