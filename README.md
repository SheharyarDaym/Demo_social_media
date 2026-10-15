# Lifeguard-Pro.org — Social Studio (simplified demo)

Choose social platforms, generate a post, edit it if needed, and approve it to post now or at a chosen time.

This is a browser-only preview. Posts come from prepared captions, images and a sample video bundled with the app. There are no AI keys, social logins or real posts. “Posting” records **Posted in preview** locally.

## Run it

Prerequisites: Node.js 20+ and npm.

```bash
cd app
npm install
npm run dev            # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run build` | Type-check and build into `dist/` |
| `npm run preview` | Serve the build at http://localhost:4173 |
| `npm test` | Unit tests (approval rules, scheduling, duplicate prevention, simplified flow) |
| `npx playwright install chromium` | One-time browser download for end-to-end tests |
| `npm run test:e2e` | End-to-end tests of the two screens |

## The two screens

**Create Post** (opens first)
1. *Where do you want to post?* Facebook, Instagram, LinkedIn, X, Snapchat, TikTok, YouTube. Facebook and Instagram are pre-selected.
2. *What should the post be about?* One text box, plus **Same post** or **Different posts**.
3. **Generate Post** shows about two seconds of progress, then the prepared content. The small **Create later** link instead saves one future time to create a draft.

Each post card shows the image (or video), the platforms, and one editable caption with its hashtags. It has three actions:
- **Rewrite caption**
- **Change image**: Generate another / Upload image. You can also drop an image onto the picture.
- **Approve & Post**: Post now or Schedule for later.

Edits save automatically.

**My Posts** has three tabs: **Needs approval**, **Scheduled** and **Posted**. A *Drafts to create later* list appears above the tabs only while there are draft requests.

## Two-minute walkthrough
1. Keep Facebook and Instagram selected, type a topic, click **Generate Post**.
2. Click **Rewrite caption**, then **Change image → Generate another**.
3. Click **Approve & Post**, keep **Post now**, click **Approve & Post Now**.
4. Open **My Posts → Posted** to see *Posted in preview*.
5. Create another post and choose **Schedule for later**.

## How it behaves
- **Same post:**
  - One shared card for the selected platforms. Snapchat uses the vertical version of the same image.
  - If YouTube is selected, a separate video card is added (“YouTube needs a video, so we prepared a video version.”) with the same wording. It needs its own approval.
- **Different posts:** one card per platform.
- **Approval is mandatory:**
  - Generating never posts.
  - Approving covers exactly the content shown and the chosen time.
  - Editing an approved or scheduled post moves it back to *Needs approval* and cancels the scheduled time.
  - **Cancel schedule** keeps the content.
- **No duplicates:** double-clicks and repeated timers cannot post twice. Each send is checked against the approval when it runs.
- **Saved in this browser:** posts, edited captions and uploaded images (PNG, JPEG or WebP, up to 10 MB) are stored in IndexedDB and survive a refresh. An invalid upload shows a plain message and keeps the current image.
- **Scheduling only runs while the preview is open:**
  - After reopening, an overdue draft request offers **Create draft now**, and an overdue post offers **Review posting time**.
  - Nothing posts silently after the preview was closed.
- **Logo:** the header uses the Lifeguard-Pro.org emblem cropped from the supplied header screenshot (`public/assets/brand/lifeguard-pro-logo.png`, 118 px). Replace that file with the original high-resolution logo for production-quality sharpness. A logo uploaded earlier in this browser takes precedence.
- **Platform icons:** official platform marks from Font Awesome Free brand icons (CC BY 4.0, https://fontawesome.com/license/free), shown in each platform’s colours. Platform names and logos are trademarks of their owners.

## What was removed in this version
The earlier full prototype is archived, not compiled, in `../_archive/full-prototype-src/`. These were removed from the product:
- the Overview dashboard and metric cards
- the separate Approvals, Calendar, Generation Schedules, Content Library, Media Library, Accounts, Brand Settings and Help pages
- custom grouping, recurring schedules, role switching, revision/audit panels, bulk actions, timezone settings, failure simulators, the demo clock, exports and the notifications centre

**Existing saved data is kept.**
- Posts from the earlier version appear in the three My Posts tabs.
- Old recurring schedules stay stored but no longer run.
- My Posts offers an optional, confirmed **Replace them with three simple examples**.

## Folder overview
```
app/src/app/            layout (top navigation) and routes
app/src/features/       create/ (Create Post), posts/ (My Posts), post/ (post cards, Approve & Post, actions)
app/src/domain/         approval, publishing and scheduling rules; simplePosts.ts maps the simple flow onto them
app/src/services/       prepared-content engine, scheduler, media helpers
app/src/fixtures/       captions, media catalogue, seed (three examples)
app/public/assets/      bundled illustrations and sample videos
app/tests/              unit and end-to-end tests
```

## Limitations
- The sample videos are WebM; older Safari versions show the cover image instead.
- Scheduling works only while a preview tab is open.
- If two tabs edit the same caption at once, the last save wins (duplicate posts are still prevented).
- Previews show the image and caption, not a pixel-perfect copy of each platform’s layout.
