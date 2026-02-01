What is done so far:

1. I set up ts starter with pocketflow

2. Prepared env file - DO NOT READ ENV FILE NEVER DO IT all the envs names are available in `.env.example`

3. I set up dependencies for scheduler: `agenda` with postgres driver (https://github.com/agenda/agenda), `Telegraph` for telegram bot (https://github.com/telegraf/telegraf) - read package json file for versions

4. Postgres is already running via compose file. App must us only node to run now - DO NOT DOCKERIZE the app

Issues that were persent in python version:

1. Code abstractions leakage. Despite providing all the context parts that were LLM generated added abstraction leakage. Like this:
`superhuman/reminder-bot/main.py`
```python
MAX_CONVERSATION_MESSAGES = 20
conversations: dict[str, list[dict]] = {}


def _trim_conversation(conv: list[dict]) -> list[dict]:
    """Keep only the most recent MAX_CONVERSATION_MESSAGES messages."""
    if len(conv) <= MAX_CONVERSATION_MESSAGES:
        return conv
    return conv[-MAX_CONVERSATION_MESSAGES:]
```

As you see here leak is clear - there are shared store and you can write a good store with data by user retrieval but it actually did bad code and introduced top level map as temp solution - this is ultra bad and it couldn't be later used to extend it to context building system.

2. Runtime issues python related - easy fixable just with switching to node js. I dont even provide an examples because they are redundant.

3. Instuctions are not perfect - this could not be fixed easily because here we rely on LLM. The issue is LLM did not convert user query properly. It doesnt get all the required formats and ignores part of instructions always. Do you best to improve system prompt

4. Docs are outdated - current implementation is newer then docs so skip docs for reminder bot.

5. Messed with dates, timezones and output data format.

6. /home/jebuscross/.cache/pypoetry/virtualenvs/superhuman-KHK2dvPE-py3.13/lib/python3.13/site-packages/pocketflow/__init__.py:44: UserWarning: Flow ends: 'done' not found in ['need_info', 'schedule_once', 'schedule_cron', 'list', 'cancel', 'cancel_all', 'set_timezone']
  if not nxt and curr.successors: warnings.warn(f"Flow ends: '{action}' not found in {list(curr.successors)}") - even missed some important flow end paths

What needs to be better:

1. Clean code styles, reasonable size functions, clean readable programm flow.
2. Following abstractions that pocketflow gives and adding other missing abstractions nice way
3. Tests - skip it we will write them together, because they will be required also to test instructions

Useful Context:

1. Best agent so far with tool use instead of yaml output format: `superhuman/src/agents/native-tools-agent`

2. Pocketflow docs: `superhuman/pocketflow/docs`

3. Pocketflow typescript port: `PocketFlow-Typescript/README.md`, `PocketFlow-Typescript/cookbook`

4. Reminder bot source code to work against: `superhuman/reminder-bot`

DESTINATION: `reminder-bot-ts`

Port reminder bot from python to typescript
