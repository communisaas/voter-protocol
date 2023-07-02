# Read tokens (in-progress)

**What's the value of someone reading your message?**

Email headers like `Return-Receipt-To` and `Disposition-Notification-To` ask common mail clients/apps to send back read receipts/open events. These events are more reliable than what tracking pixels provide, and give more explicit right-to-consent for sending a receipt.

This smart contract operates on the [Solana](https://solana.com/) blockchain since it has reasonable transaction fees and throughput.

## How it works

A writer publishes an email message template onto the platform, directed at a decision-maker who is vetted by the community.

A message sender enables verified read receipts & sends email through [communi.email](communi.email)

> so

1. A [public-private key pair](https://www.cloudflare.com/learning/ssl/how-does-public-key-encryption-work/) is generated server-side
2. Private key signs the email, and the signature is appended as a [subaddress](https://datatracker.ietf.org/doc/html/rfc5233); message headers are mirrored to a database
3. Email is dispatched, secured via [Transport Layer Security (TLS)](https://www.cloudflare.com/learning/ssl/transport-layer-security-tls/)
4. Smart contract containing the public key is created on the Solana blockchain

> and then

Receipient opens email message
  1. Email read receipt ([MDN](https://datatracker.ietf.org/doc/html/rfc8098)) sent
  2. Endpoint within [communi.email](communi.email) queries original email headers
      - Check if properties match
  3. If email checks out, and email-writer-sender trio has not already successfully executed on the blockchain, execute contract to verify email signature

> and then

Contract validates email signature by checking public key
  - If good signature:
    - token now free for the email sender and writer to withdraw
  - Else:
    - no token
