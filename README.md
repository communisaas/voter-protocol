# Read tokens (in-progress)

**What's the value of someone reading your message?**

Email headers like `Disposition-Notification-To` ask mail clients to send back read receipts/open events. These events are more reliable than what tracking pixels provide, and give more explicit right-to-consent for sending a receipt.

This smart contract operates on the [Stellar](https://stellar.org/) blockchain since it has reasonable transaction fees and is highly scalable across independent communities.

## How it works

- Token distribution service receives an email read receipt
  - Query `communi.email` for the email's sender address hash
  - Package it with the read receipt (which should have the unhashed address as plaintext metadata)
  - Send token & data to contract address

> and then

- Contract validates hash of sender address between `communi.email` and incoming receipt
  - If good hash:
    - token now free for the email sender to withdraw
  - Else bad hash:
    - no token
