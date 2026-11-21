-- How INDAI's hosted voice speaks, set by the owner for every device: speed (ElevenLabs takes 0.7 to 1.2; 1 is the
-- voice's own pace) and feel (steady, natural or expressive; natural leaves the voice as it was made).
alter table public.indai_voice
  add column speed numeric(3,2) not null default 1.00 check (speed between 0.70 and 1.20),
  add column feel text not null default 'natural' check (feel in ('steady', 'natural', 'expressive'));
