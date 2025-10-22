# Quickstart: Your First Action in 4 Minutes

**No blockchain knowledge needed. No wallet setup. No seed phrases.**

**Phase 1 Launch** (3 months): Build reputation, send cryptographically verified messages, prove civic utility. No tokens yet—just better constituent-representative communication.

**Phase 2 Future** (12-18 months): VOTER token rewards, challenge markets, outcome markets. Economic incentives launch after proving Phase 1 works.

-----

## What You'll Do (Phase 1)

1. Create account with Face ID or fingerprint (30 seconds)
2. Verify your identity via NFC passport scan (2 minutes)
3. Pick a template or write your own (1 minute)
4. Add your personal story (30 seconds)
5. Send to your representative (instant, cryptographically verified)
6. Build reputation (earn credibility points, see your impact)

Total time: 4 minutes. You'll build portable reputation that proves your civic expertise across platforms.

-----

## Step 1: Create Account (30 seconds)

Visit communique.app and tap "Get Started"

- **Use Face ID or fingerprint** - That's it. No passwords, no "write this down on paper."
- **Account is cryptographically secure** - Face ID controls wallet addresses on every blockchain
- **No setup complexity** - The crypto part happens invisibly in the background

If your device doesn't have biometrics, you can use a PIN. The point: no friction, no crypto jargon.

-----

## Step 2: Verify Identity (2 minutes)

**Phase 1 requires verification** - Your messages must cryptographically prove district membership to reach congressional offices. This eliminates spam and gives staffers quality signals they're asking for.

**Both methods are FREE:**

### Method 1: Passport NFC Scan (Recommended - 70% of users)
- Tap "Verify with [self.xyz](https://www.self.xyz)"
- Hold phone near passport (NFC chip authentication)
- Face ID liveness check confirms it's you
- Done - instant cryptographic verification
- **Cost:** $0 (FREE tier, no credit card)

### Method 2: Government ID Upload (Alternative - 30% of users)
- Tap "Verify with [Didit.me](https://www.didit.me)"
- Upload government ID (driver's license, state ID)
- Face ID liveness check confirms it's you
- Verification completes in 1-2 minutes
- **Cost:** $0 (FREE Core KYC tier)

**What verification gets you (Phase 1):**
- Messages reach congressional offices (unverified messages filtered as spam)
- Reputation building that follows you across platforms (ERC-8004 portable standard)
- Higher priority when congressional staff filter messages (reputation score visible)
- Ability to create templates (not just use them)
- Sybil resistance (one verified identity = one account, cryptographically enforced)

**Phase 2 additions:**
- Full token reward amounts (unverified users earn 50% rates)
- Participation in challenge markets (economic stakes on verifiable claims)
- Outcome market positions (bet on legislative outcomes)

**Privacy guarantee:** Your passport/ID data never touches our servers. NFC authentication happens locally on your device using government-issued cryptographic signatures. Congressional offices see only "verified constituent in TX-18" - never your name, address, or ID details.

-----

## Step 3: Pick a Template (1 minute)

Browse templates by topic: healthcare, climate, labor, education, democracy, local issues.

Each template shows (Phase 1):
- **Subject line** - What your representative will see
- **Message body** - Structured argument with evidence
- **Creator reputation** - Has this person's work influenced bills before?
- **Adoption count** - How many verified constituents have sent this?
- **Content moderation status** - Passed 3-layer review (OpenAI + Gemini/Claude consensus + human)

**Phase 2 additions:**
- **Challenge status** - Have any claims been tested in challenge markets and verified?
- **Outcome market correlation** - Is there financial backing for predicted legislative outcomes?

**Popular templates right now:**
- Medicare drug price negotiation support
- 4-day work week for city employees
- Climate disclosure requirements for corporations
- Student debt relief expansion
- Ranked choice voting for local elections

**Or write your own** - Verified users can create templates. **Phase 1**: Build reputation when others adopt them and when your templates influence legislation. **Phase 2**: Earn token rewards proportional to adoption and impact.

-----

## Step 4: Add Your Story (30 seconds)

Templates provide the structure. Your personal connection makes it real.

Example template: "Support Medicare Drug Price Negotiation"

**Customization block prompts you:**
> "Why does this matter to you personally?"

**You add:**
> "My mother rations her insulin because it costs $380/month on a fixed income. Medicare negotiation could cut that to $35. This isn't abstract policy to me—it's whether she can afford to stay alive."

**This is what staffers are desperate for** - personal stakes from verified constituents, not form-letter spam. Offices explicitly stated they want ["small surprising things" and "niche issues" with informed reasoning](http://www.samiam.info/wp-content/uploads/2019/02/ConstiuentCorrespondence_McDonald_Dec_2018.pdf). Your personal connection transforms a template into something they can't ignore.

-----

## Step 5: Send (Instant)

Tap "Send to My Representative"

**What happens behind the scenes (Phase 1):**
1. Your browser encrypts everything before it leaves your device (XChaCha20-Poly1305)
2. Halo2 zero-knowledge proof generates (4-6 seconds)
   - Proves you live in your district without revealing your address
   - Address never leaves browser, never touches any database
3. Message passes 3-layer content moderation (OpenAI + Gemini/Claude + human review)
4. Encrypted delivery through GCP Confidential Space TEE (AMD SEV-SNP hardware attestation)
5. Delivery to congressional CWC API from whitelisted IP
6. Cryptographic receipt confirms delivery (timestamp + proof verification)
7. Your action records on Scroll L2 blockchain (only district hash + reputation update, never your identity)

**What you see:**
- Progress bar showing proof generation (4-6 seconds total)
- "Message Delivered" confirmation
- Delivery receipt with timestamp
- Which staffer's inbox it reached (if office uses our dashboard)

-----

## Step 6: Build Reputation (Immediate)

**Phase 1: Reputation Points** (portable across platforms via ERC-8004 standard)

**You earn reputation for:**
- Sending messages to representatives (+50 points per message)
- Creating templates others adopt (+100 points per adoption)
- Templates that influence legislation (+1,000 points per verified correlation)
- Consistent engagement over time (multiplier increases with history)
- Domain expertise (healthcare, climate, labor, etc. tracked separately)

**Your reputation determines:**
- Priority when congressional staff filter messages (higher rep = higher priority)
- Credibility signals staffers see ("8,740 healthcare policy reputation")
- Template creation privileges (minimum 500 points required)
- Influence in community discussions
- **Phase 2**: Token reward multipliers when economic layer launches

**Impact Tracking (Phase 1):**
- ImpactAgent monitors correlation between template sends and legislative outcomes
- Tracks: template sends → bill introduction → topic similarity → legislative action
- Confidence score calculation (timing + language similarity + geographic clustering)
- When confidence >80%: Everyone who sent that template earns impact reputation multiplier

**Example:** You send template supporting climate disclosure. 500 others send it. Two weeks later, related bill introduced with similar language. ImpactAgent verifies 85% confidence correlation. Your reputation: +50 (base send) + 1,000 (impact correlation) = 1,050 points earned. Template creator earns +100 per adoption × 500 = 50,000 points + 1,000 impact bonus.

-----

## Phase 2: Token Rewards (12-18 months)

**After Phase 1 proves civic utility**, economic layer launches:

**Base Token Rewards:**
- Verified user sending template: ~2,875 VOTER tokens
- Unverified user: ~1,437 VOTER tokens (50% rate)
- Current value: Check live prices (tokens tradeable on DEXs)

**Network Effect Bonus:** Template creators earn when others adopt:
- 10 adoptions: 100 VOTER bonus
- 100 adoptions: 2,000 VOTER bonus
- 1,000 adoptions: 30,000 VOTER bonus

**Impact Multiplier:** Verified legislative correlation:
- ImpactAgent confidence >80% → 10x multiplier on all rewards
- Example: 2,875 base → 28,750 VOTER for everyone who participated

**Reputation Multiplier:** Phase 1 reputation converts to Phase 2 token boosts
- Every 1,000 reputation points = +10% token reward multiplier
- Early Phase 1 participants earn significantly more when Phase 2 launches

-----

## What to Do with Reputation (Phase 1)

**Build Domain Expertise:** Focus on specific policy areas (healthcare, climate, labor) to become recognized expert

**Create Templates:** 500+ reputation unlocks template creation. High-adoption templates earn massive reputation when others use them.

**Influence Congressional Priority:** Higher reputation = higher priority when staffers filter messages. Your 8,500 healthcare reputation means staffers see you as domain expert, not random constituent.

**Earn Phase 2 Multipliers:** Every 1,000 reputation points = +10% token rewards when economic layer launches. Early Phase 1 participants positioned for significant Phase 2 earnings.

**Portable Credibility:** ERC-8004 standard means your reputation follows you across platforms. Other civic tech projects can read your VOTER Protocol reputation.

-----

## What to Do with Tokens (Phase 2)

**Phase 2 adds economic mechanisms** (12-18 months):

**Hold:** Token value increases as more people participate (network effects)

**Trade:** Instant conversion to dollars through DEX integrations

**Stake on Outcomes:** Outcome markets let you bet on whether bills pass. Win → earn payout. Lose → money funded civic infrastructure anyway. Financially compete with corporate lobbying.

**Challenge False Claims:** See misinformation in a template? Stake tokens challenging it. Multi-AI consensus (67% agreement across 6+ models) adjudicates. Right → win challenger's stake. Wrong → lose yours. Economic consequences for bad faith.

**Governance:** Token holders vote on protocol changes, agent parameters, treasury allocation.

-----

## Privacy: What Staffers See vs. What's Private

**Congressional office sees (Phase 1):**
- "Verified constituent in TX-18" (Halo2 zero-knowledge proof of district membership)
- "Reputation score: 8,500 in healthcare policy" (domain expertise from on-chain actions)
- "Content moderation: Passed 3-layer review" (OpenAI + Gemini/Claude + human)
- "Previous templates correlated with 2 legislative outcomes" (impact tracking verified)
- Your message content and personal story

**Phase 2 additions:**
- "Template survived 3 challenge attempts" (accuracy verified in challenge markets)
- "Outcome market position: $2,500 staked on related bill passage" (financial backing)

**Congressional office NEVER sees:**
- Your name
- Your address
- Your phone number
- Your email
- Your device information
- Your wallet address
- Your full participation history

**Platform operators (us) see:**
- District hash (meaningless without your private data)
- Wallet address (not connected to your identity anywhere)
- Encrypted message blob (can't decrypt it)
- Delivery receipts (timestamp only)

**Employers/Schools/Doxxers see:**
- Nothing. Your wallet address earned reputation. Which human controls that wallet? The connection doesn't exist in any database.

**Data brokers see:**
- Cryptographic proofs scrolling by. Can't reverse-engineer locations from them.

**This isn't "we promise not to look"** - The system is designed so the connection between your identity and your civic actions doesn't exist anywhere. Mathematically impossible to trace, not just policy-protected.

-----

## Common Questions

**Q: I don't understand blockchain. Do I need to?**
A: No. Same way you don't need to understand TCP/IP to use email. The crypto part is invisible.

**Q: What if I lose my phone?**
A: Use Face ID on your new phone. Account recovery uses your biometric, not seed phrases you can lose.

**Q: Can my employer find out I sent a message?**
A: No. Zero-knowledge proofs mean your employer sees nothing. Even if they subpoena us, the database doesn't contain the mapping between your identity and your wallet. Nothing to give them.

**Q: What if I disagree with a template's facts?**
A: **Phase 1**: Report it for human review (moderation team investigates). **Phase 2**: Challenge it with token stakes. Multi-AI consensus (67% agreement across 6+ models) adjudicates using verifiable evidence (voting records, public data, congressional records). Right → win stake. Wrong → lose stake. Economic consequences make false information expensive.

**Q: How do I know my message actually got delivered?**
A: Cryptographic receipt with timestamp. If office uses our dashboard, you can see which staffer's queue it entered.

**Q: Do I have to verify identity?**
A: **Phase 1**: Yes, for messages to reach congressional offices. Unverified messages filtered as spam (staffers need quality signals). Verification is FREE ([self.xyz](https://www.self.xyz) passport NFC or [Didit.me](https://www.didit.me) government ID). **Phase 2**: Unverified users can participate with reduced token rewards (50% rate) but verified users get full economic benefits.

**Q: What if I don't care about earning tokens?**
A: **Phase 1**: You're building reputation that proves civic expertise. Staffers prioritize your messages over spam. Your impact gets tracked and verified. Phase 1 is about proving democracy can work better. **Phase 2**: When economic layer launches, your Phase 1 reputation converts to token reward multipliers. Early participants positioned for significant Phase 2 earnings. Privacy protection and congressional access matter regardless of economic incentives.

**Q: Is this legal?**
A: Yes. **Phase 1**: Cryptographic privacy, reputation systems, and content moderation are legal frameworks used across tech. Identity verification via [self.xyz](https://www.self.xyz)/[Didit.me](https://www.didit.me) complies with KYC best practices. Section 230 CDA provides platform immunity with content moderation good faith efforts. **Phase 2**: [CLARITY Act](https://www.congress.gov/bill/119th-congress/house-bill/3633/text) framework classifies utility tokens as digital commodities. Civic participation rewards are constitutionally protected speech. Outcome markets operate under existing prediction market regulatory frameworks.

**Q: What's stopping spam?**
A: **Phase 1**: Rate limits (10 messages/day per verified identity), [self.xyz](https://www.self.xyz)/[Didit.me](https://www.didit.me) Sybil resistance (one identity = one account), 3-layer content moderation (OpenAI + Gemini/Claude + human), reputation requirements (low-rep accounts flagged for review). **Phase 2**: Economic consequences through challenge markets (false claims lose stakes), reputation decay for low-quality participation.

-----

## Next Steps

**Just start:** [communi.email](https://communi.email) → Create Account → Verify Identity → Pick Template → Send

**Go deeper:**
- [README.md](README.md) - Why this exists and what changes
- [TECHNICAL.md](TECHNICAL.md) - Cryptographic details (Halo2 zero-knowledge proofs, self.xyz, GCP TEE, Scroll L2)
- [CONGRESSIONAL.md](CONGRESSIONAL.md) - Congressional office integration and quality signals
- [ARCHITECTURE.md](ARCHITECTURE.md) - Complete technical architecture (Phase 1 + Phase 2 evolution)
- [SECURITY.md](SECURITY.md) - Living threat model and incident response

-----

*The whole point is making this accessible. If anything in this guide felt complicated, that's a bug. Let us know.*
