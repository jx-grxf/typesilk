-- off until the owner turns it on; the board shows names either way, the profile only on request
ALTER TABLE users ADD COLUMN public_profile INTEGER NOT NULL DEFAULT 0;
