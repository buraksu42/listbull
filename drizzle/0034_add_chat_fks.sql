-- 0034 — add missing FK constraints (security audit M3).
--
-- The schema previously claimed (in comments) that `messages.chat_id`
-- and `bot_action_contexts.{chat_id, target_chat_id, item_id}` had
-- foreign-key constraints to chats / items, but the actual references
-- were never added. Adding them now closes orphan-row drift on chat /
-- item deletion + matches the documented intent.
--
-- Clean up any pre-existing orphan rows before ALTER...ADD CONSTRAINT
-- so the migration can't fail on dirty production data.

DELETE FROM "messages"
 WHERE "chat_id" NOT IN (SELECT "chat_id" FROM "chats");

DELETE FROM "bot_action_contexts"
 WHERE "chat_id" NOT IN (SELECT "chat_id" FROM "chats");

UPDATE "bot_action_contexts"
   SET "target_chat_id" = NULL
 WHERE "target_chat_id" IS NOT NULL
   AND "target_chat_id" NOT IN (SELECT "chat_id" FROM "chats");

UPDATE "bot_action_contexts"
   SET "item_id" = NULL
 WHERE "item_id" IS NOT NULL
   AND "item_id" NOT IN (SELECT "id" FROM "items");

-- messages.chat_id → chats.chat_id (cascade: drop conversation
-- history when its chat is deleted).
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_chat_id_chats_chat_id_fk"
  FOREIGN KEY ("chat_id") REFERENCES "chats"("chat_id")
  ON DELETE CASCADE
  ON UPDATE NO ACTION;

-- bot_action_contexts.chat_id → chats.chat_id (cascade: drop
-- pending force-reply prompts when their chat dies).
ALTER TABLE "bot_action_contexts"
  ADD CONSTRAINT "bot_action_contexts_chat_id_chats_chat_id_fk"
  FOREIGN KEY ("chat_id") REFERENCES "chats"("chat_id")
  ON DELETE CASCADE
  ON UPDATE NO ACTION;

-- bot_action_contexts.target_chat_id → chats.chat_id (cascade).
ALTER TABLE "bot_action_contexts"
  ADD CONSTRAINT "bot_action_contexts_target_chat_id_chats_chat_id_fk"
  FOREIGN KEY ("target_chat_id") REFERENCES "chats"("chat_id")
  ON DELETE CASCADE
  ON UPDATE NO ACTION;

-- bot_action_contexts.item_id → items.id (SET NULL on item delete:
-- prompts for non-item-bound flows like set_key keep working;
-- per-item prompts simply lose the item reference).
ALTER TABLE "bot_action_contexts"
  ADD CONSTRAINT "bot_action_contexts_item_id_items_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "items"("id")
  ON DELETE SET NULL
  ON UPDATE NO ACTION;
