# Agent ultimate security guide

Agents that go to outside world must be treated as vulnerable
They must run inside sanbox environment
They must have a schema based output with tool execution and have only limited set of tools

Typical flow: extract data and write output or write to file or to a db: analytics, marketing, research
  - in this case the only minimal set of tools must be provided and any text even in schema must be validated with regex to avoid prompt injections

Typical flow: iteractions with untrusted user's chats, bots, etc.
  - expect prompt injections - do not give any data access at all
  - also validate every tool call use
  - if required write access or special cases: have super isolated sandboxes that expected to be compromised fully

Common techniques:
  - have elevated access trap tools that when tried to execute will immediately compromise session
  e.g: to all agent add fake bash tool and fake read file/write file tool that will be likely used on jailbreak and do not provide any system instructions of tool use or even provide instructions to not use this tools (if occasionally could be used)
  - super sofiscicated attacker could know about this trap tools - in this case he will want to infiltrate system further by manipulating outputs - in this case only schema validation with programmatic checks will save you from attacker
  P.S. this is a weak point cause often you want other agent to be in a workflow and do some job after sensitive agent is done - think about the second layer more but it is 1% of all attacks or even less
