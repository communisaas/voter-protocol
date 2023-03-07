# Read tokens (in-progress)

**What's the value of someone reading your message?**

Email headers like `Return-Receipt-To` and `Disposition-Notification-To` ask common mail clients/apps to send back read receipts/open events. These events are more reliable than what tracking pixels provide, and give more explicit right-to-consent for sending a receipt.

This smart contract operates on the [Solana](https://solana.com/) blockchain since it has reasonable transaction fees and throughput.

## How it works

Message sender enables verified read receipts & sends email through `communi.email`
1. A public-private key pair is generated
    - A seed phrase is also derived from the public key
2. Public key is appended server-side as metadata to the email
3. Email is sent with transport layer security (TLS)
4. Contract is created containing seed phrase (it's a pre-shared key)

> and then

Receipient opens email message
  1. Email read receipt ([MDN](https://joinup.ec.europa.eu/collection/ict-standards-procurement/solution/mdn-message-disposition-notification/about)) sent
  2. Token distribution service queries `communi.email` for the email's private key 
      - Check it against the public key 
  3. If keys check out, execute contract

> and then

Contract validates public key by reconstructing the seed phrase
  - If good key:
    - token now free for the email sender to withdraw
  - Else bad hash:
    - no token
