# Segment triggers and the people already in the segment

Status: **decided and implemented in 12.2** (2026-11-27), except for the two follow-ups at the
end (a backfill, and `trigger.date` with a filter), which are not built.

## The problem

`trigger.segment(s)` means "a user enters when they go from not matching `s` to matching it". The
engine decides that from the membership table: a user who matches and has no membership row has
"just entered".

A segment that was never swept has no rows, so everyone who already matches is read as having
just entered. Whether that happens depends on what was deployed before:

| Deploy history                                                         | First sweep after the deploy |
| ---------------------------------------------------------------------- | ---------------------------- |
| Segment and its trigger shipped together                               | Every current matcher enters |
| Segment shipped and swept earlier, the trigger added in a later deploy | Nobody enters                |

The same code, two outcomes, and the README says nothing about either. A reviewer reproduced it:
three users with a purchase before the deploy, `started 3` when segment and trigger shipped
together, `started 0` when the segment was swept first.

Two cases follow from the same mechanism:

- Renaming a segment's `id` makes it a new segment: everyone is read as entering again.
- Widening a condition (`within: '7 days'` to `'14 days'`) enters everyone it newly covers.

## What other products do

Every product looked at keeps existing members out by default. They differ in how existing
members are let in when that is wanted.

| Product     | By default                                                                 | To include existing members                                                                                    |
| ----------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Klaviyo     | Only profiles that join the segment after the flow is live                 | A separate one-time action, "Add past profiles", placing them at the start or spread through the flow          |
| Iterable    | "Subscribe to list" watches for new subscriptions only                     | A different entry source, "Schedule", which periodically adds every list member                                |
| Customer.io | Forward-looking: entry at the moment the condition is met                  | Legacy trigger: include current matches when starting. Running campaign: a "force match" tool, through support |
| HubSpot     | A choice that must be made when the workflow is turned on                  | "Enroll existing" on the review page, with an estimated count; asked again whenever a live workflow is saved   |
| OneSignal   | A checkbox, "Future additions only"                                        | Leave it unchecked. Checked, it is permanent and the segments are locked once live                             |
| Braze       | Different model: users must be in the entry audience before the entry time | A scheduled entry rather than an action-based one                                                              |

Two shapes of configuration come out of this:

1. **A choice made once, at launch** (HubSpot, OneSignal, legacy Customer.io). The option belongs
   to the act of starting, not to the workflow's definition.
2. **The trigger always looks forward; existing members are a separate backfill** (Klaviyo,
   Iterable, current Customer.io).

How edits to a live trigger are handled also varies: OneSignal locks the segments, HubSpot asks on
every save whether to enrol the newly matching, Klaviyo's help says an edited segment does not
back-fill.

### How far to trust this

- Read directly: Customer.io's triggers page and OneSignal's Journeys settings.
- From search summaries, not the pages themselves: Klaviyo, Iterable, HubSpot, Braze. Klaviyo's
  and Iterable's details come largely from community threads.
- Customer.io's current "Attribute or Segment" trigger page states no setting for existing
  matches. "Forward-looking by default" and the force-match tool come from a search summary and a
  community thread, and were not confirmed on an official page.
- OneSignal's page gives no default for its checkbox.

### Sources

- Customer.io: [Automation triggers, filters, and frequencies](https://docs.customer.io/journeys/campaign-triggers/),
  [community: adding people to an existing workflow](https://community.customer.io/campaigns-6/adding-people-to-an-existing-workflow-in-customer-io-842)
- OneSignal: [Journeys settings](https://documentation.onesignal.com/docs/en/journeys-settings)
- Klaviyo: [How to create a segment triggered flow](https://help.klaviyo.com/hc/en-us/articles/360003040052-How-to-create-a-segment-triggered-flow),
  [Why didn't my segment trigger the flow](https://help.klaviyo.com/hc/en-us/articles/360031002471-Why-didn-t-my-segment-trigger-the-flow-),
  [community: flow only sends to new segment members](https://community.klaviyo.com/marketing-30/klaviyo-flow-only-sends-to-new-segment-members-how-to-target-existing-users-19214)
- Iterable: [Tutorial: Build Your First Journey](https://support.iterable.com/hc/en-us/articles/4405783163284-Tutorial-Build-Your-First-Journey),
  [community: list subscribe with the current list](https://community.iterable.com/iterable-platform-2/starting-journey-with-list-subscribe-but-want-it-to-trigger-with-current-list-as-well-927)
- HubSpot: [Workflows FAQ](https://knowledge.hubspot.com/workflows/workflows-faq),
  [Set event enrollment triggers](https://knowledge.hubspot.com/workflows/set-event-enrollment-triggers)
- Braze: [Create a Canvas](https://www.braze.com/docs/user_guide/messaging/canvas/create_a_canvas),
  [Delivery and entry types](https://www.braze.com/docs/user_guide/messaging/messaging_fundamentals/delivery_and_entry_types)

## What is different here

In those products the choice is made by a person pressing "start", once. Here the configuration
is code, and every deploy reads it again. An option in the DSL that says "enter existing members"
therefore has two problems the SaaS checkbox does not:

- After the first deploy it does nothing, and stays in the code looking as if it did.
- Removing a trigger and adding it back makes a new route, and the option would enter everyone a
  second time.

There is also no deploy command to ask in. A Cloudflare deploy is `wrangler deploy`, and the new
version applies its own bundle on its first request; `POST /bundle/deploy` exists for rollbacks
and for hosts without version metadata. `workflow-ui plan` is the one step that runs before a
deploy and reads the live database: it reports what a bundle would break for journeys in flight
and exits 1.

## Decisions

All taken 2026-11-27.

1. **A segment trigger only looks forward.** Someone who already matches when the segment is
   deployed is recorded as a member and starts nothing. Reason: entering a whole existing audience
   by accident costs far more than missing it, and a segment-triggered workflow is for people who
   become something, not for everyone who already is. This is every surveyed product's default.
2. **No option in the DSL to include existing members.** For the reasons under "What is different
   here": it would be dead configuration after its first deploy, and would fire again if the
   trigger were removed and put back.
3. **An edited condition is seeded again.** The users an edit newly covers are recorded, not
   entered — also when the edit is to a segment this one is built on. One rule holds everywhere:
   a deploy never starts journeys in bulk.
4. **The trigger is named for what it waits for: `trigger.enters(segment)`.** `trigger.segment`
   stays as a deprecated alias; the IR does not change.
5. **One `segment` object, no separate "audience".** GA4 keeps two (a segment is a retroactive
   query, an audience accumulates members from its creation and has an "audience trigger" for
   entry) because they are stored and computed differently there. Here one definition is both: it
   is evaluated on the spot where a condition names it, and its membership is kept by the sweep.
   The two uses differ in time, so the difference is carried by the name of the use
   (`trigger.enters` against a `filter`), not by a second noun to define twice.
6. **A trigger keeps its `filter`.** A filter on the trigger decides before an instance exists; a
   `filter` step decides after. The user turned away by a step has entered (which a `never`
   re-entry policy then holds against them), cost an instance, and counts in the workflow's
   entries.
7. **No membership duration on a segment, for now.** "Stays a member for N days after matching"
   would make a condition depend on the membership table instead of on facts alone. What it is
   mostly used for is already `performed(e.x, { within })`; what that cannot say ("was Pro at some
   point in the last 30 days") is better served by an event when the property changes.

## How it works

Membership is per segment, and the starts a new member is owed are written with the membership.
That already made a trigger added to a swept segment start nothing. What was missing is the
segment with no membership yet, so the state lives on the segment, not on the route:

- `segment.seeding_since` is set by a deploy for a segment that is new, whose condition hash
  changed, or that names (directly or through others) a segment for which either holds. A segment
  that is as it was keeps its value, so applying the same bundle again — every Worker version
  does — starts nothing over.
- While it is set, an evaluation that finds a matching non-member records the membership and
  writes no start. That holds on both paths: the user's own activity and the sweep.
- A sweep reads the seeding segments before its first page and clears them after its last. It
  clears by id **and** by the `since` it read, so a deploy landing mid-sweep is left for the next
  one. On AWS these are two more durable steps around the pages.
- A null is a seeded segment, so the column needs no data step and segments deployed before the
  upgrade carry on unchanged.

"What counts as a new route" needed no answer in the end: nothing is recorded per (workflow,
segment).

### The window

Until the first sweep after a deploy completes, a user who genuinely enters the segment cannot be
told from one who was already in it, and is recorded without a journey. That is one sweep. A
sweep that is cut short does not complete, but the next one has less to do (those already
recorded are no longer candidates), so it converges; review item 2.2 (a Cloudflare sweep cannot
continue across cron runs) is what makes the window longer for large audiences.

## A segment used as a condition is not affected

Everything above is about `trigger.enters(s)`. A segment named in a condition — a trigger's
`filter`, a `branch`, a `filter` step, a `waitUntil` — is not read from the membership table at
all: the engine evaluates the segment's definition against the user's facts at that moment, so it
answers for everyone who matches now, however long they have matched and whenever the segment was
first deployed.

So "email every purchaser on Black Friday", written as a scheduled workflow with `purchaser` as
its filter, reaches the old purchasers: on the day, each user is asked "are you a purchaser now?".

## Not built yet

### A backfill

The case this decision makes worse: a segment that was simply missing before, and a new workflow
on it. None of the people already in it enter. That is the intended default, but it should be one
step to undo: an explicit operation, per workflow, that starts a journey for every current member
of the trigger's segment. Going through the entry ledger, it would obey the workflow's `reentry`
policy (a second run against a `never` workflow starts nothing) and could be run at any time.

A limit to state plainly: it would enter who matches **when it runs**. Someone who matched last
month and no longer does was never a member and is not recovered.

Still to decide: where the operator is asked. Proposed is a CLI command run after the deploy that
shows the count and asks in a terminal (`--yes` otherwise), with `workflow-ui plan` reporting, for
a segment a deploy would seed, how many users match and will not enter. Prompting inside `plan`
is not proposed: it runs in CI, and before the deploy, when the answer cannot be acted on yet. A
single `workflow-ui deploy` that plans, asks, deploys and backfills is the alternative; on
Cloudflare the bundle goes live with the Worker version, so it would have to wrap `wrangler
deploy`.

### `trigger.date` with a filter

What the Black Friday workflow lacks is the schedule: `trigger.date(at)` compiles but is not
routed by the runtime, and takes no filter.

```ts
trigger.date('2026-11-27 09:00:00', { filter: purchaser });
```

It and the backfill are close to the same operation — start a journey for a set of users at once,
rate-limited — and should share one fan-out. The filter can be compiled to SQL to list the
candidates, as the sweep already does for segments.
