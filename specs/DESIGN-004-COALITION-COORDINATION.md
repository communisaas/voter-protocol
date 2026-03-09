# DESIGN-004: Coalition Coordination via Shared Templates

> **Status:** DESIGN
> **Date:** 2026-03-06
> **Affects:** CampaignRegistry.sol, DEBATE-MARKET-SPEC.md, COMMUNIQUE-INTEGRATION-SPEC.md
> **Problem:** Multiple advocacy orgs working the same issue are siloed into separate campaigns with no template sharing, no send aggregation, and no mechanism for inter-org negotiation.

---

## 1. Current State

### 1.1 The Constraint

`CampaignRegistry.sol:263` enforces template exclusivity:

```solidity
if (actionToCampaign[actionId] != bytes32(0)) revert TemplateAlreadyLinked();
```

A template can belong to exactly one campaign. If Sierra Club creates a template about a climate bill, NRDC cannot include that template in their own campaign. NRDC must create a near-duplicate, splitting sends and fragmenting the signal to decision-makers.

### 1.2 What This Produces

- 3 orgs × 1 template each = 3 send counts instead of 1 aggregate
- Staffer sees 3 campaigns on the same bill from different orgs — same noise as before
- No mechanism for orgs to converge on messaging without backroom coordination
- Debate market can stress-test a single template but can't negotiate across org-owned duplicates

### 1.3 What AN Produces (worse)

Action Network has the same silo problem but worse: each org's list is proprietary, sends go to different email addresses, and the staffer has no way to aggregate across orgs. The protocol should solve this, not replicate it.

---

## 2. Design: Templates as Public Goods

### 2.1 Core Principle

**The template is the coordination primitive, not the org.** A template is a public good: anyone can create one, anyone can send it, anyone can contest it via debate market. Campaigns are *views* — an org's curated lens on a set of templates relevant to their mission.

### 2.2 Contract Changes

**Remove template exclusivity.** A template can appear in multiple campaigns.

```
actionToCampaign  (1:1 mapping)  →  actionCampaigns  (1:many set)
```

**Per-campaign metrics remain.** Each campaign tracks its own `participantCount` and `districtCount` — the org's view of their coordination impact.

**Template-level metrics emerge.** A template's total send count aggregates across all campaigns that reference it. This is the number the decision-maker sees.

```solidity
// New: template-level aggregation
mapping(bytes32 => uint256) public templateParticipantCount;
mapping(bytes32 => uint256) public templateDistrictCount;
mapping(bytes32 => mapping(bytes32 => bool)) public templateDistrictSeen;
```

**`recordParticipation` updates both:**

```solidity
function recordParticipation(bytes32 actionId, bytes32 districtRoot) external {
    // Update template-level metrics (always)
    templateParticipantCount[actionId]++;
    if (!templateDistrictSeen[actionId][districtRoot]) {
        templateDistrictSeen[actionId][districtRoot] = true;
        templateDistrictCount[actionId]++;
    }

    // Update campaign-level metrics (for each campaign referencing this template)
    // Note: gas-bounded by MAX_CAMPAIGNS_PER_TEMPLATE
    bytes32[] storage campaigns = templateCampaigns[actionId];
    for (uint256 i = 0; i < campaigns.length; ) {
        bytes32 cid = campaigns[i];
        if (campaigns[cid].status == CampaignStatus.Active) {
            campaigns[cid].participantCount++;
            if (!campaignDistrictSeen[cid][districtRoot]) {
                campaignDistrictSeen[cid][districtRoot] = true;
                campaigns[cid].districtCount++;
            }
        }
        unchecked { ++i; }
    }
}
```

**Gas bound:** `MAX_CAMPAIGNS_PER_TEMPLATE = 20`. A template in 20 campaigns costs ~20× the storage writes. At Scroll L2 gas prices this is negligible. If a template is in more than 20 campaigns, it's a de facto public good and doesn't need per-campaign tracking — the template-level metrics suffice.

### 2.3 Campaign as Endorsement

An org adding a template to their campaign is an **endorsement**: "we recommend our community take this action." The template's send count doesn't change — it already aggregates from all sources. But the org's campaign view shows "of our 2,400 community members, 847 sent this template."

This inverts the AN model. In AN, the org *creates* the action and *owns* the sends. In the protocol, the org *endorses* an action that already exists as a public good. The sends belong to the individual (sovereign verified identity), not the org.

### 2.4 New: Campaign Endorsement Event

```solidity
event TemplateEndorsed(
    bytes32 indexed campaignId,
    bytes32 indexed actionId,
    address indexed endorser    // campaign creator
);
```

This creates an on-chain record of which orgs endorse which templates — a public coordination signal. Decision-makers can see: "This template is endorsed by Sierra Club, NRDC, and EDF. 2,100 verified constituents across 94 districts."

---

## 3. Debate Market as Inter-Org Negotiation

### 3.1 The Current Flow (backroom)

1. Sierra Club drafts messaging on climate bill
2. Calls NRDC, EDF, League of Conservation Voters
3. 3 weeks of negotiation over wording
4. Joint letter or coordinated but separate action pages
5. Nobody knows if the messaging was actually effective

### 3.2 The Protocol Flow (adversarial, public)

1. **Sierra Club creates a template.** Posts it. Gets sends.
2. **NRDC thinks the framing is wrong.** Opens a debate market on the template. Submits an AMEND argument with an alternative framing and evidence items (see EVP-001).
3. **EDF agrees with NRDC's amendment but wants a data point added.** Submits another AMEND argument in the same market. Stakes on it.
4. **The market resolves.** AI evaluation + tier-weighted community signal determines the strongest framing. The winning AMEND becomes a new template.
5. **All three orgs endorse the winning template.** Sends aggregate under one number. The debate market's resolution record shows the community tested the messaging and converged.

The decision-maker sees: "2,100 verified constituents. Template framing survived adversarial debate (62% AMEND consensus, 14 participants). Endorsed by 3 organizations."

### 3.3 What This Replaces

- Backroom messaging calls → public adversarial debate
- Org-owned duplicate action pages → shared template with endorsements
- "We agreed on the wording" → "the market resolved and the evidence-backed framing won"
- Trust in org brand → trust in debate market resolution + evidence provenance

### 3.4 Template Forking

When an AMEND argument wins a debate market, the amendment becomes a new template (new actionId). The new template carries provenance:

```
TemplateProvenance {
  parent_template:     bytes32    // original template that was amended
  debate_market_id:    bytes32    // market that produced this amendment
  winning_argument:    bytes32    // argument hash that won
  resolution_score:    uint16     // final_score from debate resolution
}
```

This creates a version history. Decision-makers can see: "This template evolved from an earlier version. The community amended it after adversarial debate. Here's what changed and why."

Users who sent the original template can be notified that an amended version won the debate. They can choose to send the amendment as a follow-up (new nullifier, new action domain).

---

## 4. Org Identity on Protocol

### 4.1 What Is an Org?

An advocacy org on the protocol is:

- **A wallet** that creates campaigns (CampaignRegistry)
- **A reputation** built from template curation quality (templates endorsed → community adoption → debate market performance)
- **A curator** pointing their community at the best available templates
- **Not a gatekeeper** — they don't own the list, don't own the sends, don't control the template

### 4.2 Org Reputation (Future)

Org reputation emerges from:

- Templates they created that gained adoption (weighted by tier of adopters)
- Templates they endorsed that survived debate market challenge
- Templates they endorsed that were later amended (negative signal — endorsed before testing)
- Campaign geographic coverage (districtCount / total possible)

This is not spec'd here — it's a future extension of the engagement tier system. But the data to compute it (campaign endorsements, debate market outcomes, template adoption) exists on-chain once this design ships.

### 4.3 Dissolution Path

The protocol's endgame (civic assemblies coordinated on voter-protocol) means the org's role diminishes:

**Phase 1 (now):** Org creates templates, coordinates the engagement ladder (sign → call → show up), blasts their list via external tools.

**Phase 2 (Cancel AN):** Org endorses templates, coordinates the ladder, uses protocol-native notification. The blast layer moves on-protocol. The org's value is curation and community, not infrastructure.

**Phase 3 (Transcend):** The engagement ladder is protocol-native (agentic monitoring, escalation triggers). The org's value is purely strategic: policy expertise, institutional relationships, coalition strategy. The "list" is the protocol's verified user base, not the org's proprietary database.

At each phase, the org sheds infrastructure dependency and retains only the value that can't be automated: human judgment about political strategy.

---

## 5. Migration from Current Contract

### 5.1 Breaking Change

Removing `TemplateAlreadyLinked` is a breaking change to CampaignRegistry. Current campaigns have templates that assume exclusivity.

**Options:**

A. **Deploy CampaignRegistryV2** with shared template support. Migrate active campaigns. Old contract read-only.

B. **Add `endorseTemplate()` alongside existing `createCampaign()`.** Existing campaigns keep exclusive templates. New endorsements are additive. Migration is gradual.

Option B is preferred — no data migration, backward compatible, orgs can start endorsing existing templates immediately.

```solidity
/// @notice Endorse an existing template in this campaign
/// @dev Unlike createCampaign, does NOT require template exclusivity
function endorseTemplate(bytes32 campaignId, bytes32 actionId) external
    campaignExists(campaignId)
    onlyCampaignCreator(campaignId)
    campaignActive(campaignId)
{
    // Template may already be in another campaign — that's the point
    _campaignTemplates[campaignId].push(actionId);
    // Add reverse mapping (many campaigns per template)
    templateCampaigns[actionId].push(campaignId);

    emit TemplateEndorsed(campaignId, actionId, msg.sender);
}
```

### 5.2 Existing `createCampaign` Behavior

Keep `TemplateAlreadyLinked` on `createCampaign` for backward compatibility — creating a campaign with a template still claims it. But `endorseTemplate` is the new path for shared templates. Over time, `createCampaign` could be relaxed too, but there's no urgency.

---

## 6. Open Questions

1. **Should orgs be able to endorse templates they didn't create?** This design says yes — endorsement is "we recommend this action," not "we wrote this." But should there be a creator approval step?

2. **Template-level vs. campaign-level metrics in the staffer view?** The staffer should probably see the template-level number (total verified sends) with campaign endorsements as context. But some orgs may want to show "our community's contribution" — campaign-level number.

3. **Gas cost of multi-campaign participation recording.** If a template is in 15 campaigns, `recordParticipation` writes to 15 campaign structs. At Scroll L2 gas prices (~$0.001/write), this is ~$0.015 per send. Acceptable, but worth monitoring.

4. **Debate market on endorsed templates.** If Org A endorses Org B's template and a debate market amends it, does the endorsement carry to the amended template? Probably not automatically — the org should re-endorse the amendment explicitly.

5. **Spam endorsements.** Can a spam org endorse a legitimate template to associate with it? Endorsement is on-chain and attributable. Org reputation (4.2) would surface this. But may need rate limiting or governance flagging of endorsements, not just campaigns.
