-- raised by a reset, so devices that still hold the old stats drop them instead of uploading them again
ALTER TABLE users ADD COLUMN profile_epoch INTEGER NOT NULL DEFAULT 0;

CREATE TABLE profile_shares (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device)
) STRICT;
