## What and why

## Testing
<!-- What was run and what it showed: `npm run validate`, the PR preview link, renders or screenshots
     of the figures touched. Paste results, not "validated". -->

## Risk
<!-- Low: new figures or a new collection.
     High: an engine repin or a spec edit to a published figure (list which figures move, from their
     specs); any change to embed/v1/embed.js (live on every host page within ~10 minutes of merge, and
     a PR preview cannot exercise it); build or CI scripts. -->

## How to revert
<!-- Usually: revert this PR; merging the revert republishes. Slugs and figure folder names are public
     embed URLs, so removing a published figure breaks its embeds. A repin reverts by repinning the
     previous engine tag and re-running `npm run vendor-spec`. -->
