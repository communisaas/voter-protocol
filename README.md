# Verified Outreach to Elected Representatives: The Democracy Protocol

*Building verifiable political participation at scale*

---

## The Attention War

Democracy has a distribution problem. While [TRUMP‑linked memecoins touched ~$40B in 24 hours on Inauguration Day](https://www.aljazeera.com/economy/2025/1/20/trump-linked-meme-coins-see-trading-volumes-near-40bn-on-inauguration) [1], a floor vote barely dents the feed. Citizens who've never called a representative learned automated market makers and slippage overnight. **Both chambers route constituent messages through Communicating with Congress (CWC)** on the backend. But the public experience is still a patchwork of webforms with shifting fields and limits. Auto‑replies go unopened ([CWC overview](https://www.house.gov/doing-business-with-the-house/communicating-with-congress-cwc) [8]; [CMF summary](https://www.congressfoundation.org/resources-for-congress/office-toolkit/improve-casework-menu-item/1617-summary-of-constituent-correspondence-tactics) [2]).

The problem isn't technology. It's incentive design. Speculation rewards attention with immediate, personal feedback. Democratic participation offers delayed, uncertain outcomes with no personal value accrual. When TikTok optimizes for engagement over truth and Robinhood gamifies markets, civic work reads like homework in a world built for dopamine.

Civic participation continues declining among younger demographics. Voter turnout in off-year elections remains low among 18-29 year olds. Congressional approval ratings remain historically low. The attention economy increasingly rewards financial speculation over democratic citizenship.

Under the noise is new capacity for coordination. Monad provides cheap EVM anchoring for receipts and registries; we optionally mirror to an ETH L2 (ERC‑8004 registries) when ETH‑native consumers need on‑chain reads. ERC‑8004 was built for AI agents—we extend it to human civic participants. Self Protocol proves human eligibility without exposing identity ([Self docs](https://docs.self.xyz/) [7]; [Businesswire](https://www.businesswire.com/news/home/20250723204002/en/Google-Cloud-Integrates-with-Self-a-ZK-Powered-Identity-Protocol-to-Power-AI-Adoption-and-Web3-Innovation-by-Human-Users) [8]). The rails exist. VOTER uses them to make participation verifiable, privacy‑preserving, and worth someone's time.

Also, the volume is real: congressional offices received **81 million** messages in 2022 and still miss or under‑track major channels ([Fireside 2024 Staffer Survey](https://www.fireside21.com/resources/congressional-staffer-communication/) [3]); typical "we got it" form replies see only about half of recipients open them ([Congressional Management Foundation](https://www.congressfoundation.org/resources-for-congress/office-toolkit/improve-casework-menu-item/1617-summary-of-constituent-correspondence-tactics) [2]).

VOTER leverages this convergence to create the first protocol for verifiable political participation. Civic engagement transforms from unpaid labor into stakeholder ownership of democratic infrastructure itself. Information overload and eroding trust plague democracy. VOTER builds verifiable political participation at scale by ensuring information quality and truthfulness in democratic discourse. Civic action becomes verifiable, privacy-preserving, and credible.

## What Success Looks Like

Democracy that actually competes for attention. Representatives get signal instead of spam. Citizens build reputation that follows them across every political platform.

**The feed changes.** Verified civic actions trend alongside memecoins. Congressional messages with high credibility scores go viral. Challenge markets surface truth faster than Twitter can spread lies—truth emerges from community consensus, not central arbitration. Challenge markets reward accuracy over ideology.

**The incentives flip.** Contacting representatives becomes profitable. Information quality determines earnings. Reputation becomes portable political capital. Democracy pays better than speculation because truth compounds while lies decay.

**The system adapts.** AI agents optimize for authentic engagement instead of gaming metrics. Carroll Mechanisms reward surprising insights that change minds. Cross-platform reputation creates democratic influencers whose credibility spans Reddit, Discord, and new platforms not yet invented.

**Scale hits different.** Congressional offices get higher quality input from verified constituents. Researchers access reputation-weighted datasets. Media sources information from credible civic participants. AI policy analysis weighs your input by verified civic track record. Democracy works with AI instead of getting replaced by it. International democracies adopt the same infrastructure.

This isn't incremental reform—it's democracy infrastructure that makes participation worth someone's time.

## Architecture as Political Philosophy: Evolving Governance for the Digital Age

VOTER starts where legitimacy starts: verification. Each action produces a mathematical claim about authenticity. That claim scales from a single message to district‑level sentiment without revealing who you are.

Our architecture builds for trustless agents and verifiable interactions. ERC-8004 was built for AI agents. We extend it to human civic participants. Same infrastructure that makes AI agents credible makes your civic participation credible. Three layers mirror constitutional systems:

1.  **Identity — eligibility without surveillance (ERC-8004 Identity Registry).** Zero‑knowledge (zk) passport proofs via Self Protocol attest age and citizenship and bind one passport to one participant. No raw PII leaves the device. One human, one seat at the table ([Self docs](https://docs.self.xyz/) [6]; [zk‑passport repo](https://github.com/zk-passport/proof-of-passport) [7]). This forms the basis of an ERC-8004 compliant identity registry, enabling verifiable and privacy-preserving agent interactions.

2.  **Verification — administration without guesswork (ERC-8004 Validation & Reputation Registries).** A verifier gateway checks adapter receipts (e.g., CWC delivery or mail routing) and tracks information quality outcomes in the ERC-8004 Reputation Registry. Challenge market results, discourse quality metrics, and claim verification build portable credibility scores. Hash receipts are pinned to IPFS and attested on Monad (no PII on‑chain). Distributed agents coordinate verification and reputation scoring; outcomes anchor to Monad for auditability.

3.  **Execution — treasury and records.** Monad anchors registries/attestations; treasuries remain on ETH/L2 (Safe). No routine bridging.

The outcome is simple: a public record of participation that offices can trust and citizens can carry, built on a foundation of verifiable agent interactions.

This architecture transforms civic participation from charity work into stakeholder ownership of democratic infrastructure itself. Network effects strengthen with adoption. Technical integration creates sustainable competitive advantages. This hints at a new paradigm for collective decision-making.

## Adaptive Infrastructure: Information Quality Markets

VOTER replaces rigid, hardcoded blockchain mechanics with intelligent AI agents that adapt to real human behavior and political dynamics. Rather than fixed parameters, specialized agents optimize for authentic democratic participation.

**Carroll Mechanisms** solve democracy's information problem. Political discourse drowns in noise because bad information travels as fast as good. We fix this with markets for truth, anchored by ERC-8004 reputation infrastructure:

* **Challenge Markets:** Any claim in templates or messages can be disputed. Put money where your mouth is.
* **Information Rewards:** Higher payouts for surprising, verifiable insights that change minds or reveal new data.  
* **Accountability Stakes:** Spread misinformation, pay the price when markets prove you wrong.

**Reputation Aggregation:** Challenge market participation, information sourcing quality, and constructive discourse contribution build cumulative credibility scores in the ERC-8004 Reputation Registry. High-reputation participants get priority routing to congressional offices. Low-reputation claims require additional verification.

This creates **portable democratic credibility**—reputation that follows you across platforms. Every civic action builds verified signal that other democratic tools can trust.

### Agent Network Architecture

* **VerificationAgent**: Validates civic actions through multi-source verification—adapting thresholds based on action patterns and network conditions
* **SupplyAgent**: Dynamically adjusts VOTER token minting rates based on participation levels, economic conditions, and governance goals
* **MarketAgent**: Monitors and optimizes economic incentives to maintain sustainable engagement without distorting democratic authenticity
* **ImpactAgent**: Measures real civic impact and representative responsiveness to calibrate reward systems
* **ReputationAgent**: Builds credibility scores from discourse quality and challenge market participation, coordinating priority routing for high-reputation participants

### Dynamic Parameter Calibration

Unlike traditional protocols with hardcoded constants, VOTER's infrastructure continuously calibrates key parameters:

* **Reward calculations** adapt based on civic impact measurement rather than fixed "10 VOTER per message" rules
* **Verification thresholds** adjust based on network conditions and spam detection patterns
* **Economic incentives** evolve to maintain authentic democratic participation vs. speculative gaming
* **Governance proposals** emerge from system analysis of community needs and participation patterns

Agents evolve with political dynamics and user behavior. Democratic authenticity stays intact.

**Quality discourse pays. Bad faith costs.**

## Where this becomes a market

We do not sell votes or outcomes. We sell verified civic action infrastructure.

* **CWC Message Verification**: Authenticated congressional outreach through official Communicating with Congress API, with delivery confirmations and structured data that congressional offices actually process. **Both the House and the Senate route through Communicating with Congress (CWC)**—we conform to the secure XML schema and rate limits; we log confirmations ([House CWC overview](https://www.house.gov/doing-business-with-the-house/communicating-with-congress-cwc) [8]; [CWC level‑of‑service](https://www.house.gov/sites/default/files/uploads/documents/cwc-advocacy-vendor-level-of-service-standards.pdf) [9]).
* **Direct Action Verification**: Proof of participation in verified political events, campaigns, and advocacy activities with cryptographic attestation.
* **Researchers and media** license privacy‑preserving panels and district time series.

The budgets are not imaginary. The 2024 federal election cycle cleared ~$15.9B ([OpenSecrets](https://www.opensecrets.org/news/2024/10/opensecrets-projects-2024-election-spending-to-exceed-previous-record/) [10]); federal lobbying is a steady multibillion annual line ([Bloomberg Government](https://about.bgov.com/insights/company-news/federal-lobbying-spending-reached-new-high-in-2024-bloomberg-governments-10th-annual-top-performing-lobbying-firms-report-finds/) [11]); public‑affairs SaaS has nine‑figure revenue signals (e.g., FiscalNote's 4k+ customers and ~$100M revenue) ([Investor release](https://investors.fiscalnote.com/news/news-details/2025/FiscalNote-Reports-Fourth-Quarter-and-Full-Year-2024-Financial-Results/) [12]).

### Revenue Model and Sustainable Economics

The platform generates revenue through multiple streams while maintaining public good characteristics:

* **Transaction fees** of 0.1% on credit operations scale with adoption while remaining negligible for individual users
* **Premium subscriptions** ranging from $15/month for advanced analytics to $500/month for enterprise API access serve political organizations and researchers  
* **Data licensing** agreements with academic institutions and media organizations provide additional revenue while maintaining strict privacy protections

Platform economics create network effects that strengthen with adoption: Citizens join because their civic actions generate verifiable value. Representatives benefit from higher-quality constituent communication through cryptographic filtering. Political organizations gain access to authentic grassroots mobilization tools. Researchers access verified civic engagement datasets. Each participant's value increases with network size.

## Economics Deep Dive: How Truth Makes Money

**Base Rewards:** Every verified civic action mints VOTER tokens. Congressional messages through CWC get baseline rewards. Direct action verification gets higher multipliers. Agents calculate rewards based on impact measurement—no hardcoded "10 tokens per message" nonsense.

**Challenge Markets:** Any claim in templates or personalized messages can be disputed. Challengers stake VOTER tokens. Markets resolve through consensus mechanisms and community verification. Winners take the pot. Losers pay for low-quality information.

**Information Rewards:** Surprising insights that change minds earn multiplied payouts. Challenge market resolution reveals engagement quality over time. Constructive participants get reputation boosts = higher future rewards. Quality compounds.

**Reputation Multipliers:** ERC-8004 Reputation Registry tracks engagement quality and sourcing standards. High-reputation messages get priority congressional routing. Low-reputation claims require additional stakes to challenge. Reputation becomes tradeable political capital across platforms.

**Flow Example:**
1. User submits congressional message with claim: "Policy X will increase GDP by 5%"
2. Base reward: 50 VOTER tokens for verified CWC delivery
3. Challenger stakes 100 VOTER questioning the claim's sourcing or reasoning
4. Community evaluates the quality of evidence and discourse over time
5. If original claim demonstrates good sourcing/reasoning: User gets challenger's stake + reputation boost + multiplied future rewards
6. If claim shows poor quality/bad faith: Challenger wins stake, user's reputation drops, future rewards diminish

**Result:** Quality discourse pays. Bad faith costs. Reputation follows you everywhere. Democracy gets better signal.

## Incentive Design for Democratic Participation

The protocol separates **proof of participation** from **who pays for the pipes**.

* **VOTER Records** are non‑transferable proofs that memorialize verified actions and build civic reputation.
* **VOTER Tokens** are tradeable ERC-20 governance tokens minted upon verified civic actions—reward amounts determined dynamically by agent optimization rather than fixed constants.
* **Institutional Credits** are USD‑priced balances that fund verified outreach, analytics, and receipts.

**Bright‑line rules.** We do not reward registering to vote, voting, or choosing a candidate ([52 U.S.C. §10307(c)](https://www.law.cornell.edu/uscode/text/52/10307) [13]; [18 U.S.C. §597](https://www.law.cornell.edu/uscode/text/18/597) [14]). We block foreign funds for U.S. election activity ([52 U.S.C. §30121](https://www.law.cornell.edu/uscode/text/52/30121) [15]; [FEC guidance](https://www.fec.gov/help-candidates-and-committees/foreign-nationals/) [16]). Several states restrict per‑signature compensation for petitions, so we do not enable per‑signature bounties ([Ballotpedia overview](https://ballotpedia.org/Pay-per-signature_for_ballot_initiative_signature_gatherers) [17]).

This keeps the energy of stakeholder ownership without blurring into inducement.

### VOTER: Compensation for Verified Civic Labor

In a world where the President's memecoin cleared $40B in volume on inauguration day, the old compliance fears feel quaint. We mint VOTER tokens per verified civic action—not as payment for votes (which remains illegal under 18 U.S.C. §597), but as compensation for the verifiable work of democratic participation.

**Per-action minting creates authentic signal.** Each congressional message, each direct action, each organizing effort generates immediate VOTER rewards. This isn't vote buying—it's recognizing that contacting representatives is labor that deserves compensation. The market now understands this distinction.

**Bright-line rules remain.** We never reward voting, registering to vote, or choosing candidates. We block foreign funds. But contacting your representative? That's civic work, and in 2025's regulatory environment, compensating that work makes us competitive while cautious competitors wait for permission that already arrived.

## Verification Infrastructure and Network Effects

Trust assumptions fail at scale. Email can be automated. Phone numbers can be bought. Accounts can be generated. VOTER tightens the loop:

* **Identity:** zk proofs of age, citizenship, and uniqueness via passport NFC ([Self docs](https://docs.self.xyz/) [6]).
* **Delivery:** **House and Senate messages flow through CWC's secure XML**; deliveries get confirmations that anchor receipts ([House CWC overview](https://www.house.gov/doing-business-with-the-house/communicating-with-congress-cwc) [8]; [CWC level‑of‑service](https://www.house.gov/sites/default/files/uploads/documents/cwc-advocacy-vendor-level-of-service-standards.pdf) [9]).
* **Authenticity:** rate limits, duplicate‑content checks, anomaly detection, and appealable challenges, guided by staff‑workflow evidence ([Congressional Management Foundation](https://www.congressfoundation.org/news/110-mail-operations) [2]).
* **Information Quality:** Messages from high-reputation participants (tracked in ERC-8004 Reputation Registry) get priority congressional routing. Low-reputation claims trigger additional verification through challenge markets. Historical accuracy determines message weighting and reward multipliers.

More verified actions produce better aggregates. Better aggregates attract researchers and media. That revenue funds better tools and stronger incentives. The flywheel is civic, not speculative.

This verification infrastructure creates network effects that compound with adoption, positioning VOTER as infrastructure for scalable democratic engagement that traditional civic platforms cannot match.

## Credibility Infrastructure: Portable Democratic Reputation

VOTER creates the first **portable reputation system for democratic participation**. Unlike platform-locked karma or follower counts, ERC-8004 reputation follows participants across the democratic ecosystem.

### The Credibility Flywheel

**Better Predictions → Higher Reputation → More Influence → Better Outcomes**

- High-reputation templates get priority congressional routing
- Quality discourse earns multiplied VOTER rewards  
- Credible participants become democratic influencers whose endorsements carry weight
- Quality information providers attract followers and premium subscriptions

### Cross-Platform Democratic Infrastructure

Future democratic tools inherit VOTER's reputation layer:
- **Candidate platforms** weight endorsements by civic credibility scores
- **Policy research** filters contributors by discourse quality track records  
- **Media outlets** source expert analysis from verified civic participants
- **Academic institutions** access reputation-weighted datasets for political science research

### ERC-8004 Agent Economy Integration

Our AI agents coordinate via ERC-8004. Your civic reputation lives on ERC-8004. First protocol to make human civic participation machine-readable:
- AI systems read your democratic credibility. You control how you build it.
- Policy analysis tools weight your input by verified civic track record
- Cross-chain governance systems import VOTER reputation for voting power
- Democratic service marketplaces use reputation for service provider discovery

This transforms VOTER from a civic action tool into **foundational infrastructure for trustworthy democratic participation at scale**.

## Risk Analysis: What Could Go Wrong

**Regulatory Capture:** Established interests pressure regulators to classify VOTER as securities or ban foreign participation. **Mitigation:** Utility-first design, bright-line compliance rules, geographic segmentation. Lobbying budgets are real—we hire professionals before we need them.

**Gaming by Bad Actors:** Coordinated bot networks spam the system with fake messages and reviews. Sybil attacks manipulate reputation scores. **Mitigation:** zk passport proofs for identity; multi-source verification; anomaly detection; economic penalties that scale with impact.

**Technical Failure Modes:** Smart contract bugs drain treasuries. Oracle failures corrupt reputation data. Chain downtime breaks verification flows. **Mitigation:** Multi-sig governance, comprehensive audits, redundant oracle networks, cross-chain fallbacks. No single points of failure.

**Market Dynamics:** VOTER token price crashes destroy incentives. Challenge markets get manipulated by whales. Information rewards favor existing power structures. **Mitigation:** Dynamically calibrated parameters adapt to market conditions, diverse funding sources beyond token appreciation, reputation weighting prevents pure wealth dominance.

**Adoption Friction:** Congressional offices resist new systems. Citizens don't understand crypto mechanics. Platform switching costs feel too high. **Mitigation:** CWC integration uses existing flows, fiat payment options, reputation portability creates switching benefits.

**Information Quality Degradation:** Challenge markets devolve into partisan battles. Prediction accuracy becomes gamed. Truth gets overwhelmed by noise. **Mitigation:** Economic incentives favor accuracy over ideology; reputation systems compound quality over time; diverse verification sources prevent manipulation.

We're not naive about these risks. Each one gets addressed through technical design, economic incentives, and operational vigilance. The alternative—democracy infrastructure controlled by platforms optimizing for engagement over truth—is riskier.

## Competitive Landscape and Positioning

Single‑purpose tools fragment the space. Petition sites move signatures that never turn into meetings. Form‑email vendors flood inboxes without cryptographic signal; staff triage suffers ([CMF blog on form emails](https://www.congressfoundation.org/news/blog/1486) [18]).

**VOTER's moat is credibility infrastructure.** Beyond zk identity and delivery confirmations, we build **portable democratic reputation** through ERC-8004 reputation systems. Others build for humans OR AI. We build infrastructure both can use. Other civic platforms verify *actions*—we verify *information quality*. Congressional offices get better signal. Citizens carry reputation across platforms. AI systems read your democratic credibility. Democratic tools built on VOTER inherit trust from day one.

### Strategic Advantages

The civic technology market suffers from fragmentation across dozens of single-purpose tools with limited integration and no sustainable business models. VOTER provides comprehensive infrastructure for verified civic engagement. Technical integration and network effects create defensible competitive advantages. Self Protocol identity plus Monad anchoring provides verifiable receipts on‑chain while retaining access to ETH/L2 liquidity.

Market timing favors platforms that capture political attention while maintaining democratic legitimacy. Regulatory clarity enables compliant incentivization of civic activities. Advanced blockchain infrastructure provides consumer-friendly experience without technical complexity. Political polarization creates demand for verified information sources and authentic engagement tools.

### International Expansion Opportunities

International expansion: parliamentary democracy integration across major markets. The EU offers massive scale for verified civic engagement. Commonwealth countries—Canada, Australia, UK—provide familiar regulatory environments and compatible political systems. Strategic partnerships with government offices, academic institutions, and media organizations accelerate adoption while positioning VOTER as democracy infrastructure, not partisan politics.

## Technical Implementation and Security

* **Contracts:** `VOTERRegistry` for zk eligibility; `CommuniqueCore` for orchestration; `VOTERToken` for rewards; `AgentParameters` for dynamic config; `AgentConsensusGateway` for verifier writes; `CreditVault` for accounting.
* **Agent Infrastructure:** LangGraph coordination, Temporal workflows, ChromaDB memory, N8N automation pipelines.
* **Security:** Multi-agent verification, distributed consensus, continuous optimization, memory-based learning. No PII on‑chain.
* **Evolution:** Self-modifying parameters, emergent governance, adaptive economics, responsive verification thresholds.

### Detailed Architecture (Monad Anchoring)

VOTER's technical architecture prioritizes security, simplicity, and UX. Monad serves as the anchoring layer for registry/attest receipts. Certified legislative adapters (e.g., CWC) generate receipts that are pinned to IPFS and attested on Monad. Treasuries remain on ETH/L2 (Safe). Self Protocol provides zk eligibility proofs; no PII is stored on‑chain.

Security measures: comprehensive smart contract auditing, multi-sig governance, emergency pause functionality, redundant infrastructure. Privacy protections ensure no PII stored on-chain while maintaining verification capabilities. Platform monitoring: real-time verification of civic action authenticity, automated detection of coordination and manipulation attempts, comprehensive logging for audit and compliance.

## House and Senate, plainly

**House & Senate.** **Communicating with Congress (CWC) is our path on both ends.** We conform to the secure XML schema, apply rate‑limits by design, and log confirmations to anchor receipts ([House CWC overview](https://www.house.gov/doing-business-with-the-house/communicating-with-congress-cwc) [8]; [CWC level‑of‑service](https://www.house.gov/sites/default/files/uploads/documents/cwc-advocacy-vendor-level-of-service-standards.pdf) [9]).


## What each stakeholder gets

**Citizens** get one‑tap verified messages, attendance receipts, and portable reputation without exposing identity.
**Organizers** get verified recruitment, templated outreach, rate‑limited blast, and analytics that survive staff filters.
**Government staff** get structured intake, deduplication, cryptographic filtering, and exportable audit trails with quality information filtering.
**Researchers** get privacy‑preserving aggregates with differential privacy and k‑anonymity thresholds from verified civic action datasets.

## How we will prove it works

Run a pilot across all Congressional districts. Let users create and send templates. Measure:

* delivery confirmations via CWC (House & Senate)
* verified constituent ratio
* staff minutes saved per message
* organizer repeat rate and cost per verified action

Publish the methods. Publish the results.

## Shipping Status: Building Momentum

**Core infrastructure is live.** On-chain enforcement for verified actions. ZK registration path working. Governance scaffold deployed. Reward accounting operational. Indexing infrastructure running.

**Agent integration underway.** Multi-agent consensus system in development. CWC integration via N8N automation pipelines. Dynamic parameter adjustment mechanisms. Timelock + guardian security models.

**Next major milestones:** 
- Complete CWC API integration with agent verification
- Deploy reputation registry on ERC-8004 infrastructure  
- Launch challenge markets for information quality
- Scale to all Congressional districts

**Future expansion:** Cross-chain proof relay, transparency dashboards, international parliamentary systems. The technical foundation exists—now we build the network effects.

### Implementation Status and Next Steps

Current implementation status and development roadmap are documented in detail:

- **[Agentic System Design](docs/architecture/AGENTIC_SYSTEM_DESIGN.md)** - Multi-agent system design principles
- **[Development Roadmap](docs/implementation/DEVELOPMENT_ROADMAP.md)** - Agent-based development plan
- **[Design Documents](docs/design/)** - Credibility governance and engagement strategy
- **[Security Analysis](docs/security/)** - Vulnerability assessments and mitigation strategies

#### Current Status
- Core smart contracts with agent integration points
- Multi-agent verification framework design
- LangGraph coordination infrastructure
- Vector memory system for agent learning
- Dynamic parameter adjustment mechanisms

#### Critical Priorities
- Deploy multi-agent consensus system
- Implement dynamically calibrated reward calculations
- Complete CWC API integration with agent verification
- Establish Temporal workflow orchestration
- Launch N8N automation pipelines for civic actions

---

*VOTER Protocol Foundation | Building Democracy Infrastructure | August 2025*

**Sources**

1. Al Jazeera, "Trump's new meme coin and crypto token soar on his first day in office," January 20, 2025, https://www.aljazeera.com/economy/2025/1/20/trumps-new-meme-coin-and-crypto-token-soar-on-his-first-day-in-office
2. Congressional Management Foundation, "Summary of Constituent Correspondence Tactics," 2024, https://www.congressfoundation.org/office-toolkit-home/improve-casework-menu-item/1618-summary-of-constituent-correspondence-tactics
3. Fireside21, "How Congressional Staffers Can Manage 81 Million Messages From Constituents," 2024, https://www.fireside21.com/resources/congressional-staffer-communication/
4. ERC‑8004: Trustless Agents, https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md
5. Monad Docs, https://docs.monad.xyz
6. EAS: Ethereum Attestation Service, https://docs.attest.sh
7. Self Protocol Documentation, https://docs.self.xyz
8. BusinessWire, "Google Cloud Integrates with Self, a ZK-Powered Identity Protocol, to Power AI Adoption and Web3 Innovation by Human Users," July 23, 2025, https://www.businesswire.com/news/home/20250723204002/en/Google-Cloud-Integrates-with-Self-a-ZK-Powered-Identity-Protocol-to-Power-AI-Adoption-and-Web3-Innovation-by-Human-Users
9. House.gov, "Communicating with Congress (CWC) Overview," https://www.house.gov/doing-business-with-the-house/communicating-with-congress-cwc
10. House.gov, "CWC Advocacy Vendor Level of Service Standards," https://www.house.gov/sites/default/files/uploads/documents/cwc-advocacy-vendor-level-of-service-standards.pdf
11. OpenSecrets, "2024 election projected to be most expensive ever, $15.9 billion in spending," October 2024, https://indepthnh.org/2024/10/08/opensecrets-projects-2024-election-spending-to-exceed-previous-record/
12. Bloomberg Government, "Federal Lobbying Spending Reached New High in 2024, Bloomberg Government's 10th Annual Top-Performing Lobbying Firms Report Finds," https://about.bgov.com/insights/company-news/federal-lobbying-spending-reached-new-high-in-2024-bloomberg-governments-10th-annual-top-performing-lobbying-firms-report-finds/
13. FiscalNote, "Fourth Quarter and Full Year 2024 Financial Results," March 2025, https://investors.fiscalnote.com/news/news-details/2025/FiscalNote-Reports-Fourth-Quarter-and-Full-Year-2024-Financial-Results/
14. 52 U.S.C. §10307(c) - Voting Rights Act
15. 18 U.S.C. §597 - Federal Election Crimes
16. 52 U.S.C. §30121 - Foreign National Contributions
17. FEC, "Foreign nationals," https://www.fec.gov/help-candidates-and-committees/foreign-nationals/
18. Ballotpedia, "Pay-per-signature for ballot initiative signature gatherers," https://ballotpedia.org/Pay-per-signature
19. Congressional Management Foundation, "Someone Really Reads Advocacy Emails - It's Just Not Who You Think," July 18, 2017, https://web.archive.org/web/20250528073829/https://www.congressfoundation.org/blog/1380
20. Gabriel Carroll, "Robust Mechanism Design," Annual Review of Economics, 2019, https://doi.org/10.1146/annurev-economics-080218-025616
21. Network Goods Institute (Connor McCormick), "Carroll Mechanisms: Solving Futarchy's Private Information Problem," https://paragraph.com/@ngi/carroll-mechanisms
