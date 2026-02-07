# Reminder bot finishing log

What I did:

Manually rewritten fully the reminder-ts-bot to make it work nicely

Introduced arhitecture with clear software and flow parts done

Flow tests done, tests examples done


Insights:

Architecture re-defined.

LLM established insanely shitty arhitecture and code structure

Provide arhitecture docs and code template of an LLM agent, otherwise shitty code

Provide clear practicies to avoid:
 - Abstraction leaking - provide definitions and what to not do

For template doc - basically have a questions check list to ask about just following architecture template for multi-agent system


Flow re-defined.

LLM made insanely bad flow that now significantly improved.

Add example of tool call agentic loop and use latest tool call approach with dynamic handle

System prompt must be changed much during tests.


Code quality.

Mostly fine. Architecture was the issue.
