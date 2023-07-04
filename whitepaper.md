# READ: A token of acknowledgement

1. **Executive Summary**
    - Brief overview
    - The purpose and vision of Communique
    - The role of READ token within the Communique platform

2. **Introduction**
    - Detailed introduction to Communique and its objectives
    - Problem statement Communique aims to address
    - Brief introduction to the role of READ tokens within the Communique platform

3. **About Communique**
    - Communique's history, mission, and objectives
    - Understanding the need for tokenizing read receipts
    - Communique's potential for growth

4. **READ Token Overview**
    - The concept and purpose of the READ token
    - How READ token integrates with Communique's mission

5. **Technology**
    - Overview of the Solana blockchain
    - Reasons for choosing Solana as the underlying blockchain
    - The technology behind minting READ tokens
        - How Solana's scalability, security, and smart contract capabilities are leveraged
    - Detailed step-by-step process of minting READ tokens
        - Role of public-private key pair, contract validation, and email receipts
    - Communique's technical architecture
    - Security measures in place
        - Addressing potential manipulations

6.  **The Economics of READ Tokens**
    - Incentive structure for meaningful engagement
    - Potential use-cases and value drivers for READ tokens
    - How the READ token will evolve as the platform grows

7. **Token Use Cases**
    - Detailed exploration of READ token's use cases
    - Governance and voting rights
    - Staking and its implications
    - Potential future use cases

8. **Governance**
    - The structure and operation of the Communique DAO
    - The role of READ token within governance
    - Processes for proposing and voting on changes

9. **Future Plans**
    - Development roadmap
    - Potential challenges and corresponding solutions
    - Opportunities and strategic partnerships

10. **Legal and Compliance**
    - Legal structure of Communique as a DAO
    - Compliance with blockchain regulations and legislation
    - Addressing potential legal issues

11. **Conclusion**
    - Recap of the value proposition of the READ token and its role within the Communique ecosystem
    - Final remarks on the future of Communique and the READ token

12. **Disclaimers**
    - Legal disclaimers related to the investment and use of the READ token.

## 1. Executive Summary
This document offers a detailed overview of the Communique platform and its associated utility token, READ. We elaborate on the platform's vision, operational mechanisms, technical architecture, and the economics behind READ tokens.

Communique aims to harness the combined power of email and social media to amplify grassroots advocacy. Our platform seeks to bring transparency and verifiability to advocacy, enabling individuals and groups to voice their concerns and ideas directly to decision-makers. We combine the reach of email with the public accountability of social networks, turning these into a potent tool for change. Using the [mailto protocol](https://www.ietf.org/rfc/rfc2368.txt), Communique allows writers to circulate hyperlinked email templates, promoting pertinent issues globally.

Integral to Communique is the READ token. READ tokens represent successful engagements and are only minted when a decision-maker reads or acknowledges an email sent via our platform. We obtain the read receipt through an [email disposition notification](https://www.ietf.org/rfc/rfc3798.html), verified using a decentralized blockchain. The community vets decision-makers eligible to mint tokens. Both writer and sender receive tokens from each engagement, incentivizing meaningful participation. Moreover, the READ token extends beyond a reward mechanism—it serves as a tool for platform governance. 

As Communique morphs into a Decentralized Autonomous Organization (DAO), READ token holders—our most active users—will directly shape our evolution and direction. The READ token, in this respect, serves both as a means of engagement and governance.

## 2. Introduction
In the digital age, engaging with decision-makers often feels alienating. Messages frequently disappear in crowded inboxes or are dismissed by automated systems. Petition-based advocacy platforms like [change.org](https://guide.change.org/engage-decision-makers) offer limited clarity on delivery processes. Communique was conceived to counter these challenges, creating a clear conduit between individuals and decision-makers.

The primary obstacle in creating an engaged and accountable digital advocacy landscape is ensuring meaningful engagements. To overcome this, we introduce the READ token. This utility token incentivizes genuine interactions and establishes a democratic governance structure for our platform.

READ tokens are minted when an elected decision-maker acknowledges an email sent via Communique. The process of minting rewards users for generating real engagement, fostering meaningful dialogue over mass messaging.

As Communique transitions to a DAO, READ tokens will grant holders influence over the platform's development and direction, aligning platform growth with user interests.

## 3. About Communique
Communique is a digital platform bridging the gap between individuals, groups, and their decision-makers. Our platform democratizes communication, enhances transparency, and encourages meaningful engagement.

In the context of official communication, email remains pivotal. However, the deluge of daily email correspondence that decision-makers handle makes ensuring message acknowledgment challenging. Current mechanisms to verify whether a message was opened, let alone read and considered, are [unreliable](https://www.prescient-ai.io/blog/tracking-pixel-limitations) and [unethical](https://www.ketch.com/blog/pixel-tracking). This presents an opportunity for Communique to innovate.

By tokenizing read receipts, we incentivize meaningful communication, ensuring that advocacy efforts are acknowledged. Each READ token minted represents a message read by a decision-maker, verified via an email read receipt. These decision-makers form part of an allow-list managed by the community, authenticating each minted token.

READ tokens not only signify successful engagement, but also serve as the governance tool for Communique as it evolves into a [decentralized autonomous organization (DAO)](https://ethereum.org/en/dao/). Token holders become official stakeholders of a public treasury, with influence over the platform's direction.

Communique envisages significant growth potential in digital advocacy. One opportunity lies in linking the [Communicating with Congress (CWC) API](https://www.house.gov/doing-business-with-the-house/communicating-with-congress-cwc) directly with the public. This connection would enable American citizens to amplify their voices on the House floor, while receiving verification of message receipt and acknowledgment.

Furthermore, Communique plans to integrate with other governmental and non-governmental decision-making bodies, scale our platform globally, and foster partnerships with mission-aligned organizations. These steps, guided by our READ token holders, will help Communique shape the future of digital advocacy.

The following section dives into the underlying technology: the [Solana](https://solana.com/) blockchain and the mechanics of minting READ tokens.

## 4. READ Token Overview
The READ token is a unique cryptographic asset native to the Communique platform. The token's purpose is twofold: it serves as an indicator of successful engagement and as a means of platform governance.

### 4.1 Concept and Purpose of READ Token
Tokenizing read receipts stems from the need to incentivize meaningful communication, between individuals or groups and decision-makers. In the current digital landscape, voices from constituent emails [too easily go unnoticed, or are lost in the flood of communication decision-makers receive](https://mailchimp.com/resources/email-marketing-benchmarks). Petitions may be unreliable, [since delivery is not verified](https://guide.change.org/engage-decision-makers). The READ token seeks to address this issue by rewarding genuine engagement, ensuring strong voices are heard and supported by society, and verifying acknowledgement of pressing topics.

Two READ tokens are minted each time a decision-maker—part of a community-curated list—reads an email sent through the Communique platform. Elected officials of democracies that rank at least 8/10 in civil liberties and electoral process + pluralism (as recognized by [The Economist's Democracy Index](https://en.wikipedia.org/wiki/The_Economist_Democracy_Index)) are eligible by default, having fair enough integrity to back the READ token. One token is given to the writer for each time their message is read, and the other token is received by a sender—only once for each writer's message they send. This approach incentivizes writers to compose thoughtful, impactful messages, as the 'reward' is tied to the quality of communication: writers that elicit many senders have a more powerful message, and senders who propogate many writer voices are more potent catalysts of change. The process is verified on-blockchain via an email read receipt, adding an element of transparency and persistence to the interaction. Each minted READ token rewarded is a testament to successful advocacy, adding value to each meaningful dialogue initiated on the platform.

### 4.2 READ Token and Communique's Mission
The READ token aligns seamlessly with Communique's mission of fostering meaningful engagement in digital advocacy. It helps convert a messaging system that is often opaque and one-sided into one that is transparent and rewarding.

By incentivizing successful engagement, users are encouraged to share effective and impactful messages. The tokens are not just an abstract reward; they signify successful dialogue and have tangible value within the Communique ecosystem. They can be used to influence the direction and development of the platform, giving users a say in how the platform evolves.

Furthermore, the DAO structure, facilitated by READ tokens, ensures that Communique remains a community-driven platform. It places the power of decision-making into the hands of those who actively engage with the system. This aligns the platform's evolution with the needs and interests of its user base, making it a more effective tool for advocacy.

Overall, the READ token is more than just a digital asset—it is a proof of successful advocacy, and a means of platform governance. It embodies Communique's mission and vision, standing as a symbol of meaningful and effective communication.

The following section will delve deeper into the technical aspects of the READ token—how it is minted, its security measures, and its integration within the broader Solana blockchain.

## 5. Technology

### 5.1 Solana Blockchain
[Solana](https://solana.com/) is a high-performance, fairly-decentralized blockchain platform built to support scalable, user-friendly applications. It utilizes a unique consensus algorithm known as [Proof of History (PoH)](https://medium.com/solana-labs/proof-of-history-a-clock-for-blockchain-cf47a61a9274), which timestamps transactions to increase efficiency and throughput. By using PoH, Solana can handle thousands of transactions per second, making it one of the fastest blockchains in existence. Significant projects like [the Helium Network depend on it](https://docs.helium.com/solana/), and the industry's largest players—[Google](https://decrypt.co/113632/google-cloud-just-became-a-solana-validator) and [Meta](https://about.fb.com/news/2022/11/new-creators-tools-facebook-and-instagram/)—have partnered to support its infrastructure and development.

Solana supports smart contracts, self-executing contracts with the terms of the agreement directly written into code. Smart contracts are transparent, traceable, and irreversible, making them ideal for decentralized applications (dApps).

### 5.2 Why Solana?
The primary reason for choosing Solana as the underlying blockchain for Communique is its scalability, while having satisfactory potential for decentralization. As our platform aims to handle potentially millions of emails and verifiable read receipts, a transparently-managed blockchain capable of handling high transaction volumes is crucial. Solana's PoH consensus algorithm allows it to process transactions quickly and efficiently, providing the scalability Communique requires. 

Secondly, Solana's robust smart contract capabilities allow us to implement the intricate token minting process required for READ tokens. Each time an email is read by a decision-maker, a smart contract is executed to mint a new token. Solana's blockchain provides the necessary infrastructure to manage these transactions efficiently and transparently. Moreover, this consensus method is ideal for read receipts, which inherently depend on acknowledgements taking place after messages are sent. 

Finally, Solana's commitment to security and decentralization aligns with our vision for Communique. Our platform aims to democratize digital advocacy and civic engagement: a secure, auditable, and decentralized blockchain will help realize this.

### 5.3 Minting READ Tokens
The minting of READ tokens is a process that leverages Solana's smart contract capabilities. As previously mentioned, a READ token is minted when an email sent through Communique is read by a decision-maker. This process involves several steps:

0. A writer publishes an email message template onto the platform, directed at a decision-maker who is vetted by the community.
1. Another authenticated and authorized user sends the email through the Communique [communi.email](communi.email) domain, using the registered read receipt feature.
    1. A unique [public-private key pair](https://www.cloudflare.com/learning/ssl/how-does-public-key-encryption-work/) is generated on the server-side.
    2. The private key signs the email, and the signature is appended as a [subaddress](https://datatracker.ietf.org/doc/html/rfc5233). Message headers are mirrored to a database.
    3. The email is dispatched, secured via [Transport Layer Security (TLS)](https://www.cloudflare.com/learning/ssl/transport-layer-security-tls/).
2. A smart contract containing the public key is created on the Solana blockchain.
3. When the recipient opens the email, a read receipt is sent back to Communique. An endpoint within Communique (or the blockchain itself) checks if the properties of the receipt match the original email headers. This may be upgraded to occur on-chain as it is implemented.
    1. If the properties match, the smart contract is executed using the email signature as an input.
    2. The smart contract validates the signature by cross-verifying it with the public key.
    3. If the signature is valid, a READ token is minted for both writer and sender, and is made available to withdraw.

The blockchain will record every instance a sender successfully spreads a writer's message via the smart contracts. Unread message contracts expire after a significant length of time has passed (initially 1 year). Senders can only receive a token once per message, while writers receive one on behalf of every sender. 

This mechanism ensures that tokens are only minted after a verified decision-maker acknowledges an email, and that tokens are distributed proportionally to writers and senders, incentivizing meaningful engagement and dialogue.

### 5.4 Communique's Technical Architecture

Communique is designed to ensure secure, efficient, and scalable operations. It is built around three main components:

#### The Platform

This is the user-facing application where users compose and send emails. It also presents a wallet for registered users to manage their READ tokens. It is implemented using [SvelteKit](https://kit.svelte.dev/) to maximize performance, efficiency and maintainability.

Since existing social networks are leveraged to propogate messages, users may only register through another social media platform via [OpenID](https://openid.net/developers/how-connect-works/); Twitter, Facebook, Instagram, LinkedIn, and Whatsapp. Other social media platforms will be added if the community requests so. 

#### Solana Blockchain

The Solana blockchain serves as the underlying infrastructure for minting and managing READ tokens. It is also the layer where transactions are recorded.

#### Decision-Maker Allowlist: 

This is a community-curated list of decision-makers. Emails sent to addresses on this list are eligible for READ token minting upon being read.

### 5.5 Security Measures
Security is paramount in Communique's operations, considering the platform's critical tasks, including minting token securities and handling users' account data. To ensure the platform's safety, we have established several robust security measures:

### Data Security 

Communique secures all data using industry-leading encryption protocols. We store user data in encrypted databases, and all communication between our servers is secured using Transport Layer Security (TLS).

### Transaction Security 

The security of READ token transactions is guaranteed by the inherent security mechanisms of the Solana blockchain. This includes consensus-based verification, cryptographic signatures, and the guaranteed execution of smart contracts.

### Identity Verification

Communique employs [FingerprintJS](https://fingerprint.com/) for comprehensive identity verification. By leveraging various data points, FingerprintJS accurately identifies users and curtails fraudulent activities. It is renowned in the field of browser fingerprinting and identity verification, providing an extra layer of security to our platform. To preserve integrity of the READ token minting process, we are committed to integrating additional Know Your Customer (KYC) measures, mitigating risk to the same standards as world-class financial institutions and ensuring compliance with region-specific laws.

### Social Media Verification 

Users registering with Communique must verify their identities via a trusted social media platform. This additional layer of identity verification contributes to the security and authenticity of the community, further reducing the possibility of fraudulent activities.

### Allowlist Management 

The allowlist of decision-makers eligible for READ token minting is meticulously curated and managed by the READ token holder community. This democratic layer of oversight ensures a fair token minting process and prevents potential exploitation or manipulation.

### Smart Contract Security

Before deploying on the Solana blockchain, all smart contracts used by Communique undergo rigorous audits by independent third-party security experts. This ensures they are secure and function as intended, safeguarding the token minting process.

These security measures comprise a comprehensive framework that protects Communique users, maintains the integrity of the READ token, and ensures the platform operates safely and effectively. In the next section, we will delve into the economic model underpinning the READ token.
*subsequent sections in-progress*

## Disclaimers
This whitepaper is provided for informational purposes only and does not constitute legal, financial, or other professional advice. Details within this document are subject to change following governance votes by token holders. Potential token holders are advised to seek professional guidance before participating in any token-related activities. This whitepaper does not constitute a prospectus or offer document and is not an offer to sell or a solicitation of an offer to buy an investment or financial instrument in any jurisdiction.
