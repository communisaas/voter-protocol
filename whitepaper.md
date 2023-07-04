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
    - Communique's growth and achievements

4. **READ Token Overview**
    - The concept and purpose of the READ token
    - How READ token integrates with Communique's mission

5. **Technology**
    - Overview of the Solana blockchain
    - Reasons for choosing Solana as the underlying blockchain
    - The technology behind minting READ tokens
    - How Solana's scalability, security, and smart contract capabilities are leveraged
    - Communique's technical architecture
    - Security measures in place

6. **READ Token Minting Process**
    - Detailed step-by-step process of minting READ tokens
    - Role of public-private key pair, contract validation, and email receipts
    - Addressing potential manipulations

7.  **The Economics of READ Tokens**
    - Incentive structure for meaningful engagement
    - Potential use-cases and value drivers for READ tokens
    - How the READ token will evolve as the platform grows

8. **Token Use Cases**
    - Detailed exploration of READ token's use cases
    - Governance and voting rights
    - Staking and its implications
    - Potential future use cases

9. **Governance**
    - The structure and operation of the Communique DAO
    - The role of READ token within governance
    - Processes for proposing and voting on changes

10. **Future Plans**
    - Development roadmap
    - Potential challenges and corresponding solutions
    - Opportunities and strategic partnerships

11. **Legal and Compliance**
    - Legal structure of Communique as a DAO
    - Compliance with blockchain regulations and legislation
    - Addressing potential legal issues

12. **Conclusion**
    - Recap of the value proposition of the READ token and its role within the Communique ecosystem
    - Final remarks on the future of Communique and the READ token

13. **Disclaimers**
    - Legal disclaimers related to the investment and use of the READ token.

## 1. Executive Summary
This document presents an in-depth view of the Communique platform and its associated utility token, READ. It outlines the platform’s vision, functionality, and technical architecture, while emphasizing underlying economics of the creation, distribution, and use of the READ token.

Communique's primary vision is to empower grassroots advocacy by leveraging the power of email and social media, enabling individuals and groups to voice their concerns and ideas directly to decision-makers—in a transparent and verifiable manner. We believe that change is driven by communication, and effective words should never be left unfairly prioritized or unheard. To this end, Communique combines reach and familiarity of email with public accountability of social networks, creating a potent tool for advocacy and change. In essence, our platform enables writers to promote pertinent issues across the world via hyperlinked email templates, using the [mailto protocol](https://www.ietf.org/rfc/rfc2368.txt).

The READ token is a pivotal evolution to this process. Acting as a measure of successful engagement, READ tokens are only minted when an email, sent through the Communique platform, is read or counted by a decision-maker chosen by the community. The read receipt is obtained through an [email disposition notification](https://www.ietf.org/rfc/rfc3798.html), which is subsequently verified using a decentralized blockchain. Decision-makers eligible to dispatch tokens are vetted by the community, as individuals vote for their inclusion. Elected officials of democracies that rank at least 8/10 in civil liberties and electoral process + pluralism (as recognized by [The Economist's Democracy Index](https://en.wikipedia.org/wiki/The_Economist_Democracy_Index)) are eligible by default, having fair enough integrity to back the READ token. Each engagment results in two tokens minted: split between the writer and sender. Senders receive a token once, for each unique message that is read or counted on their behalf. Meanwhile, the more a writer's message is read, the more tokens they earn. Both parties must have verified social media and email accounts to participate. This incentivizes meaningful engagement, but READ tokens aren't just a reward mechanism—they're also a governance tool. 

As Communique evolves into a Decentralized Autonomous Organization (DAO), READ token holders—the platform's most prolific users—will directly influence our development and direction. In this sense, the READ token serves a dual function, facilitating both engagement and governance.

Here, we provide a comprehensive understanding of how these elements—the Communique platform, the READ token, and the underlying Solana blockchain—interlink to create a new form of digital advocacy. We hope to engage potential users, investors, and enthusiasts in our vision for a more accountable, impactful, and democratic future for advocacy.

## 2. Introduction
In the age of digital communication, engaging with decision-makers has never felt more alienating. The act of reaching out often results in messages being lost in overflowing inboxes, or dismissed by automated systems—[government-related emails are only opened ~28% of the time, the highest rate among all email campaigns measured by Mailchimp](https://mailchimp.com/resources/email-marketing-benchmarks). Even if an email is read, advocacy efforts must compete with a decision-maker's priorities. Petition-based advocacy also leaves much to be desired; [change.org](https://change.org) depends on petition organizers to [give decision-makers the message](https://guide.change.org/engage-decision-makers), making the delivery process ambiguous for signers. Communique is designed to clarify the pressing priorities of constituents and stakeholders, offering a platform that connects individuals directly with decision-makers.

However, the journey towards creating a more engaged and accountable digital advocacy landscape is fraught with challenges. One of the key hurdles is incentivizing meaningful engagements. With the proliferation of mass emails, commercial spam, and endless scams, ensuring that a message is acknowledged and known to originate from a genuine source is a considerable challenge. This is where the READ token, the native utility token of the Communique platform, comes into play.

READ tokens are a crucial part of the Communique ecosystem, providing an auditable history of engagement. They not only incentivize meaningful interactions, but also ensure a democratic governance structure for the platform. READs are minted, and equally split between sender and writer, when an email sent through Communique is acknowledged by a decision-maker. Our team will work with decision-makers to ensure email read receipts ([a.k.a disposition notifications](https://www.ietf.org/rfc/rfc3798.html)) are dispatched with integrity to Communique. This novel approach to token minting rewards users whose messages generate real engagement, thereby encouraging meaningful dialogue between social groups and decision-makers over mass messaging.

Furthermore, as Communique evolves into a Decentralized Autonomous Organization (DAO), READ tokens will empower token holders with influence over the platform's development and direction. This democratizes our own decision-making and ensures the platform remains aligned with the interests of its users.

The following sections will delve deeper into the technicalities of the platform and the intricate workings of READ tokens, providing a comprehensive view of how this innovative system will reshape digital advocacy.

## 3. About Communique
Communique is a digital platform that strives to close the gap between individuals or groups and their decision-makers. Our mission is to transform the landscape of grassroots advocacy by providing a platform that democratizes communication, enhances transparency, and fosters meaningful engagement.

Email remains a powerful tool for formal and official communication. However, the sheer volume of email correspondence that decision-makers receive daily makes it challenging to ensure that every message is read and considered. Furthermore, we currently lack [reliable](https://www.prescient-ai.io/blog/tracking-pixel-limitations) and [ethical](https://www.ketch.com/blog/pixel-tracking) mechanisms to confirm whether a message was opened, let alone read and considered—especially when it comes to interaction between the public and decision-makers.

This is where Communique sees an opportunity to innovate. By tokenizing read receipts, we aim to incentivize meaningful communication and ensure that advocacy efforts are acknowledged and considered. Each READ token minted signifies a message read by a decision-maker—verified via an email read receipt. The decision-makers are part of a carefully curated allow-list managed by the community, ensuring authenticity and significance of each token minted.

READ tokens not only provide an indication of successful engagement, but also serve as the governance tool for the Communique platform as it evolves into a DAO. Token holders are official stakeholders in the platform, with the ability to influence its development and direction: aligning the growth of Communique with the interests of its users.

As for potential growth, Communique has a vision to democratize and revolutionize digital advocacy. One significant opportunity exists in the United States government to link the [Communicating with Congress (CWC) API](https://www.house.gov/doing-business-with-the-house/communicating-with-congress-cwc) directly with the public. This will allow American citizens to amplify credible voices from anywhere to be heard on the House floor, while receiving verification that their messages have been received and counted.

In addition, Communique seeks to explore other infrastructural opportunities, such as integrating with other governmental and non-governmental decision-making bodies, scaling our platform globally, and fostering partnerships with organizations aligned with our mission. These steps, guided by the decisions of our READ token holders, will help Communique further its mission and influence in the digital advocacy landscape.

This next section delves deeper into the underlying technology: the [Solana](https://solana.com/) blockchain, and detailed mechanics of minting READ tokens.

## 4. READ Token Overview
The READ token is a unique cryptographic asset native to the Communique platform. The token's purpose is twofold: it serves as an indicator of successful engagement and as a means of platform governance.

### 4.1 Concept and Purpose of READ Token
Tokenizing read receipts stems from the need to incentivize meaningful communication, between individuals or groups and decision-makers. In the current digital landscape, voices from constituent emails [too easily go unnoticed, or are lost in the flood of communication decision-makers receive](https://mailchimp.com/resources/email-marketing-benchmarks). Petitions may be unreliable, [since delivery is not verified](https://guide.change.org/engage-decision-makers). The READ token seeks to address this issue by rewarding genuine engagement, ensuring strong voices are heard and supported by society, and verifying acknowledgement of pressing topics.

Two READ tokens are minted each time a decision-maker—part of a community-curated list—reads an email sent through the Communique platform. The process is verified on-blockchain via an email read receipt, adding an element of transparency and persistence to the interaction. One token is given to the writer for each time their message is read, and the other token is received by a sender—only once for each writer's message they send. This approach incentivizes writers to compose thoughtful, impactful messages, as the 'reward' is tied to the quality of communication: writers that elicit many senders have a more powerful message, and senders who propogate many writer voices are more potent catalysts of change. Each minted READ token rewarded is a testament to successful advocacy, adding value to each meaningful dialogue initiated on the platform.

### 4.2 READ Token and Communique's Mission
The READ token aligns seamlessly with Communique's mission of fostering meaningful engagement in digital advocacy. It helps convert a messaging system that is often opaque and one-sided into one that is transparent and rewarding.

By incentivizing successful engagement, users are encouraged to share effective and impactful messages. The tokens are not just an abstract reward; they signify successful dialogue and have tangible value within the Communique ecosystem. They can be used to influence the direction and development of the platform, giving users a say in how the platform evolves.

Furthermore, the DAO structure, facilitated by READ tokens, ensures that Communique remains a community-driven platform. It places the power of decision-making into the hands of those who actively engage with the system. This aligns the platform's evolution with the needs and interests of its user base, making it a more effective tool for advocacy.

Overall, the READ token is more than just a digital asset—it is a proof of successful advocacy, and a means of platform governance. It embodies Communique's mission and vision, standing as a symbol of meaningful and effective communication.

The following section will delve deeper into the technical aspects of the READ token—how it is minted, its security measures, and its integration within the broader Solana blockchain.

## 5. Technology

### 5.1 Solana Blockchain
[Solana](https://solana.com/) is a high-performance, fairly-decentralized blockchain platform built to support scalable, user-friendly applications. It utilizes a unique consensus algorithm known as Proof of History (PoH), which timestamps transactions to increase efficiency and throughput. By using PoH, Solana can handle thousands of transactions per second, making it one of the fastest blockchains in existence. Significant projects like [the Helium Network depend on it](https://docs.helium.com/solana/), and the industry's largest players—[Google](https://decrypt.co/113632/google-cloud-just-became-a-solana-validator) and [Meta](https://about.fb.com/news/2022/11/new-creators-tools-facebook-and-instagram/)—have partnered to support its infrastructure and development.

Solana supports smart contracts, self-executing contracts with the terms of the agreement directly written into code. Smart contracts are transparent, traceable, and irreversible, making them ideal for decentralized applications (dApps).

### 5.2 Why Solana?
The primary reason for choosing Solana as the underlying blockchain for Communique is its scalability, while having satisfactory potential for decentralization. As our platform aims to handle potentially millions of emails and verifiable read receipts, a transparently-managed blockchain capable of handling high transaction volumes is crucial. Solana's PoH consensus algorithm allows it to process transactions quickly and efficiently, providing the scalability Communique requires.

Secondly, Solana's robust smart contract capabilities allow us to implement the intricate token minting process required for READ tokens. Each time an email is read by a decision-maker, a smart contract is executed to mint a new token. Solana's blockchain provides the necessary infrastructure to manage these transactions efficiently and transparently.

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

## 5.5 Security Measures
Security is paramount in Communique's operations, considering the platform's critical tasks, including minting token securities and handling users' account data. To ensure the platform's safety, we have established several robust security measures:

### Data Security 

Communique secures all data using industry-leading encryption protocols. We store user data in encrypted databases, and all communication between our servers is secured using Transport Layer Security (TLS).

### Transaction Security 

The security of READ token transactions is guaranteed by the inherent security mechanisms of the Solana blockchain. This includes consensus-based verification, cryptographic signatures, and the guaranteed execution of smart contracts.

### Identity Verification

To preserve the integrity of the READ token minting process, Communique employs FingerprintJS for comprehensive identity verification. By leveraging various data points, FingerprintJS accurately identifies users and curtails fraudulent activities. It is renowned in the field of browser fingerprinting and identity verification, providing an extra layer of security to our platform. We are committed to integrating additional Know Your Customer (KYC) measures as required, ensuring compliance with region-specific laws.

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
