# Wisper Feature Roadmap: Phase-wise Execution Plan

**Project:** Wisper — Full-stack 1:1 messaging app
**Current Status:** Core chat working (send, receive, read receipts, search, reply, pin, delete)
**Goal:** Feature parity with WhatsApp

---

## Phase 0: Foundation (Already Complete)
- ✅ Database schema (users, conversations, messages, participants)
- ✅ Authentication (JWT, bcrypt)
- ✅ REST API (conversations, messages, read)
- ✅ Socket.io real-time (send_message, new_message, conversation_read)
- ✅ React frontend (message thread, sidebar, auth)
- ✅ Message search (FULLTEXT index, highlighting)
- ✅ Reply feature (nested replies enabled)
- ✅ Pin feature (max 5, expiry, shared)
- ✅ Delete feature (for everyone shows deleted, for me physically removes)
- ✅ Unread badges (sidebar + tab title)

---

## Phase 1: Core Chat Enhancements (2–3 weeks)
**Goal:** Live presence, delivery state, and user feedback

### 1.1 Typing Indicator
- Backend: emit `user_typing` socket event, broadcast to conversation room
- Frontend: show "typing..." below message thread
- Auto-clear after 3 seconds of inactivity
- Database: no schema change needed

### 1.2 Delivered Status
*Implemented — pending manual end-to-end verification. Details: `DELIVERY_AND_PRESENCE_PLAN.md`.*
- Database: add `is_delivered` BOOLEAN to messages (default FALSE; set TRUE when the recipient acks) — run `database/migrations/001_add_is_delivered.sql`
- Backend: socket listener for `message_delivered` (emitted by recipient on receive); messages sent while the recipient was offline are marked delivered when they next connect
- Frontend: show delivery icon progression (clock → check → double-check, green when read)
- UI: icon next to timestamp on sent message

### 1.3 Online/Offline Presence
*Implemented — pending manual end-to-end verification.*
- Backend: track socket count per user (real-time, not last_seen_at)
- Database: no change (socket count lives in memory)
- Frontend: green/gray dot next to user name in header (and a green dot on online users' sidebar avatars)
- Socket event: `user_online` / `user_offline` on connect/disconnect, plus `presence_snapshot` on connect

### 1.4 Message Reactions
- Database: add `message_reactions` table (id, message_id, user_id, emoji, created_at)
- Backend: `POST /api/reactions` and `DELETE /api/reactions/:id`
- Frontend: hover/long-press message → emoji picker (6 defaults: 👍 ❤️ 😂 😮 😢 🙏)
- Real-time: emit `reaction_added` / `reaction_removed` socket events
- UI: show emoji count badge below message (e.g., "👍 2")

### 1.5 Edit Message (within 60 mins)
- Database: add `edited_at` TIMESTAMP NULL, `is_edited` BOOLEAN DEFAULT FALSE to messages
- Backend: `PUT /api/conversations/:id/messages/:msg_id` (body: new text)
- Authorization: only sender can edit
- Time limit: only within 60 minutes of sending
- Frontend: "Edit" in context menu, show "edited" label on message
- Real-time: emit `message_edited` socket event

### 1.6 Infinite Scroll Upward
- Frontend: detect scroll to top of message list
- Fetch older messages using existing `before=<id>` cursor
- Prepend to message array (don't replace)
- Show loading indicator while fetching
- No database changes needed (use existing pagination)

**Phase 1 Deliverables:**
- Typing indicator live
- Messages show sent/delivered/seen states
- Green dot for online users
- Emoji reactions on messages
- Edit message (within 60 mins, shows "edited")
- Scroll to load older messages

---

## Phase 2: Forward & Search Polish (1 week)
**Goal:** Message sharing and improved discoverability

### 2.1 Forward Message
- Backend: `POST /api/conversations/:id/forward` (body: message_id, target_conversation_id)
- Creates a new message in target conversation with original body
- Shows "Forwarded from <name>" label
- Database: no schema change (just a new message)
- Frontend: "Forward" in context menu, conversation picker modal

### 2.2 Search Improvements
- Add date range filter (optional)
- Show message count per day
- Highlight search results in context (show surrounding messages)
- Search history (last 5 searches, stored in localStorage)

**Phase 2 Deliverables:**
- Forward message to another conversation
- Search refinements (filters, context, history)

---

## Phase 3: Media Foundation (2–3 weeks)
**Goal:** Image sending with local storage

### 3.1 Image Upload & Storage
- Backend: `POST /api/upload` (multipart form-data)
- Store in `backend/uploads/` folder (local file system for MVP)
- Return `file_path` to client
- Serve via `GET /api/uploads/<filename>` static route
- Compress on upload (ImageMagick or Sharp library)

### 3.2 Image in Messages
- Database: add `media_url` VARCHAR NULL to messages
- Backend: modify POST message endpoint to accept media_url
- Frontend: file input in message input, preview before send
- Display image in message bubble (clickable for fullscreen)
- Show upload progress bar

### 3.3 Image Gallery
- New route: `GET /api/conversations/:id/media`
- Returns all messages with `media_url` in that conversation
- Frontend: gallery modal (grid view, thumbnail preview)
- Clickable to open fullscreen or download

**Phase 3 Deliverables:**
- Upload and send images
- Images display in message thread
- Shared media gallery view

---

## Phase 4: Account & Profile (1–2 weeks)
**Goal:** User customization and control

### 4.1 User Profile Page
- Backend: `GET /api/users/:id` (public profile), `PUT /api/users/me` (own profile)
- Database: add `bio` VARCHAR(500), `profile_picture_url` VARCHAR to users
- Frontend: profile modal (view own, click on others from header or sidebar)
- Show username, last seen, bio, profile picture

### 4.2 Profile Picture Upload
- Backend: `POST /api/users/me/avatar` (multipart)
- Store in `backend/uploads/avatars/`
- Update users.profile_picture_url
- Frontend: profile picture change in settings, preview

### 4.3 Mute Conversation
- Database: add `is_muted` BOOLEAN DEFAULT FALSE to conversation_participants
- Backend: `PUT /api/conversations/:id/mute`
- Frontend: toggle in conversation menu
- Behavior: unread badges don't show, notifications disabled

### 4.4 Archive Conversation
- Database: add `is_archived` BOOLEAN DEFAULT FALSE to conversation_participants
- Backend: `PUT /api/conversations/:id/archive`
- Frontend: hide archived conversations by default, tab to show archived
- Behavior: conversation remains in database, just hidden from list

**Phase 4 Deliverables:**
- User profiles with bio and picture
- Profile picture upload
- Mute conversations
- Archive conversations

---

## Phase 5: Polish & UX (1 week)
**Goal:** Refinement and delightful interactions

### 5.1 Emoji Picker
- Frontend: full emoji library (use `emoji-picker-react` or similar)
- Searchable emoji picker
- Recently used tracking (localStorage)
- Integrate into reactions and message input

### 5.2 Swipe Gestures (Mobile)
- Swipe right on message → reply
- Swipe left on message → reactions/menu
- Library: `react-swipeable` or built-in touch events

### 5.3 Conversation Themes
- Database: add `theme` VARCHAR (default, dark, custom_color) to conversations
- Frontend: background color/image picker for each conversation
- CSS variables for dynamic theming

### 5.4 Chat Backup/Export
- Backend: `GET /api/conversations/:id/export?format=json|txt|pdf`
- Export all messages as JSON, plaintext, or PDF
- Frontend: export button in conversation menu

### 5.5 Dark Mode Refinement
- Ensure all new features respect dark mode
- CSS custom properties for theme switching

**Phase 5 Deliverables:**
- Full emoji picker with search
- Swipe-to-reply on mobile
- Custom conversation themes
- Export conversation history
- Polished dark mode across all features

---

## Phase 6: Advanced Features (3–4 weeks)
**Goal:** Advanced messaging capabilities (post-MVP)

### 6.1 Message Disappearing
- Database: add `disappear_after_seconds` INT NULL to messages
- Backend: scheduled job to delete messages after expiry
- Frontend: picker (5 sec, 1 min, 1 hour, 1 day, never)
- UI: timer showing countdown on message

### 6.2 Message Polls
- Database: create `message_polls` table (id, message_id, question, created_at)
- Create `poll_options` table (id, poll_id, option_text, created_at)
- Create `poll_votes` table (id, poll_id, user_id, option_id, created_at)
- Frontend: poll creation UI, voting UI, results display (live updates)

### 6.3 End-to-End Encryption (E2EE)
- **Very complex.** Requires:
  - Elliptic curve cryptography library (TweetNaCl.js or libsodium)
  - Key exchange on first message
  - Per-conversation key derivation
  - Encrypt before send, decrypt on receive
  - Backend stores encrypted only (can't search or read)
- Plan for Phase 7 or later

### 6.4 Chat Link/Invite
- Backend: `POST /api/conversations/:id/invite` → generates shareable link (short UUID)
- Link format: `wisper.app/join/<invite_code>`
- Frontend: invite link in conversation menu, click to start conversation
- One-time or persistent link (configurable)

### 6.5 Shared Media Gallery Enhancements
- Add filters (images, documents, links)
- Timeline view (grouped by date)
- Download multiple at once (ZIP)

**Phase 6 Deliverables:**
- Disappearing messages with countdown
- Create and vote on polls
- Shareable invite links to start conversations
- Media filtering and timeline

---

## Phase 7: Group Chat (Scope Expansion)
**Goal:** Multi-user conversations (major change)

### 7.1 Group Conversations
- Database: modify `conversations.is_group` logic
- Create `group_participants` junction table (replaces 1:1 logic)
- Add `group_name`, `group_picture_url`, `created_by_user_id` to conversations
- Backend: adapt all conversation routes to handle groups
- Frontend: show all participants, group info

### 7.2 Group Admin Roles
- Database: add `role` ENUM (admin, member) to group_participants
- Backend: `POST /api/groups/:id/add-member`, `DELETE /api/groups/:id/remove-member`
- Only admins can add/remove, change group name/picture
- Frontend: member list with role indicators

### 7.3 @Mentions in Groups
- Backend: parse message body for @username, store mentions
- Frontend: @ autocomplete during typing
- Notify mentioned users (special notification type)
- Highlight @mention in message

### 7.4 Group Notifications
- Mute group (no notifications)
- Custom sound per group
- Admin-only messages (alerts for group changes)

**Phase 7 Deliverables:**
- Create and join groups
- Add/remove members (admin only)
- @mentions in groups
- Group-specific notification controls

---

## Phase 8: Infrastructure & Scale (Post-Launch)
**Goal:** Production readiness

### 8.1 Cloud Storage Migration
- Move from local `backend/uploads/` to AWS S3 or Google Cloud Storage
- Update media URLs to CDN paths
- Implement compression pipeline

### 8.2 Message Encryption
- Implement E2EE (deferred from Phase 6)
- Key rotation, rekeying on participant changes

### 8.3 Analytics & Monitoring
- Message delivery metrics
- User engagement dashboard
- Error tracking (Sentry or similar)

### 8.4 Performance Optimization
- Database indexing for large conversations
- Redis caching for frequently accessed data
- Message pagination optimization

---

## Timeline Summary

| Phase | Name | Duration | PRs/Branches |
|-------|------|----------|--------------|
| 0 | Foundation | ✅ Complete | main |
| 1 | Core Chat Enhancements | 2–3 weeks | phase-1-core-chat |
| 2 | Forward & Search | 1 week | phase-2-forward-search |
| 3 | Media Foundation | 2–3 weeks | phase-3-media |
| 4 | Account & Profile | 1–2 weeks | phase-4-profile |
| 5 | Polish & UX | 1 week | phase-5-polish |
| 6 | Advanced Features | 3–4 weeks | phase-6-advanced |
| 7 | Group Chat | 2–3 weeks | phase-7-groups |
| 8 | Infrastructure | Ongoing | phase-8-infra |

**Total estimated time:** ~15–20 weeks for Phases 1–7 (WhatsApp-complete MVP)

---

## Current Phase: Evening Work (Phase 1 Foundation)

Before starting Phase 1 formally, complete the gaps from earlier in the conversation:

1. **Typing indicator** — socket event, broadcast to room
2. **Delivered status** — is_delivered flag, delivery icon
3. **Online/offline presence** — socket count, green dot
4. **Browser notifications** — when tab hidden
5. **Infinite scroll upward** — load older on scroll to top

These are prerequisites for Phase 1.

---

## Next Steps

1. ✅ Finish context-menu features (reply, pin, delete) — run Claude Code prompts
2. ✅ Evening: write prompts for Phases 1–2 (typing, delivered, online, reactions, edit, forward)
3. ✅ Sprint Phase 1 (2–3 weeks): get typing + delivered + presence live
4. ⏳ Then Phase 2 (1 week): forward + search improvements
5. ⏳ Phase 3+ as time allows

---

## Notes for Resume

Each phase is a discrete feature set that ships independently:
- **Phase 1:** "Added real-time user presence, delivery status, message reactions, and edit functionality"
- **Phase 3:** "Implemented image upload, compression, and shared media gallery"
- **Phase 7:** "Extended to multi-user groups with admin controls and @mentions"

By Phase 5, Wisper is a **production-ready 1:1 messaging app**. Phase 6–7 add enterprise features (disappearing messages, polls, groups). This is interview-strength work.