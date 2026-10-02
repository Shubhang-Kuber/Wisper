USE wisper;

-- Delivered status: FALSE until the recipient's client acknowledges the message
-- (socket event `message_delivered`) or the recipient next connects.
ALTER TABLE messages ADD COLUMN is_delivered BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: every message that exists before this feature shipped counts as delivered.
UPDATE messages SET is_delivered = TRUE;
