-- Retro web admin: allow is_admin() to delete individual help_comments.
-- Apply this file on the production project (hrqxdfwuucrknqznrpse).
--
-- What this does
--   Adds help_comments_delete_admin, so a Fate Tavern admin can delete a
--   single comment from the web admin without deleting the post.
--   Existing help_comments_delete_own (author only) is unchanged.
--
-- FK behaviour (already in production; this migration does not change it)
--   help_comments.parent_id  ON DELETE SET NULL
--     Replies stay; they become top-level comments if their parent is deleted.
--   help_comment_cheers.comment_id  ON DELETE CASCADE
--     Cheers on the deleted comment are removed.
--   help_notifications.comment_id  ON DELETE SET NULL
--     Related notifications keep the post, lose the comment pointer.
--   help_comments.post_id  is unchanged; deleting a comment never deletes the post.

drop policy if exists "help_comments_delete_admin" on public.help_comments;
create policy "help_comments_delete_admin"
  on public.help_comments for delete
  using (public.is_admin());

comment on policy "help_comments_delete_admin" on public.help_comments is
  'Admins may delete any Fate Tavern comment. Replies are kept (parent_id SET NULL).';
