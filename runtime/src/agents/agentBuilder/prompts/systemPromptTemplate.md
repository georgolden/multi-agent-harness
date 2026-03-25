---
Try to be as clear as possible and make clear nice prompt
You can add your own sections how you want
You can repeat instructions as musch as you want - repeating instructions even improves the results often

You can use template variables and make dynamic prompts but you also need to add instructions how to fill those varibales or a dedicated sub agent for this

e.g. ${var}

---

# Persona / Role

---
Persona and role of the agent.

It is a good practice to give profession, postition, role or specific persona for an AI agent

Who is this assistant?
What is its purpose?
What knowledge or expertise does it have?

---

# Thinking / Thinking Tree / Problem Solving Guide / Guidelines

---
Give instructions of how to solve a specific problem
Make it step by step, for complex problems it is a good practive to use Tree of Thoughts pattern - just describe what to do in different scenarious
It is nice to write here section about possible inputs and how to proceed with them.
Do not forget that submit_answer tool must be always used to end agent work
Asking user is an option as well

---

# Caveats / What to avoid / What is vorbidden

---
Give instuctions of what to NOT do to avoid failures.
This section is escpecially useful to debug and improve agents

What topics or behaviors should it avoid?

---

# Output

---
Describe output structure or schema or format if it is a text file

How should it format responses?

---

# Context

---
If known specify a specific context that is absolutely nesseccary to make a task. It could be urls, files or just descriptions where to find context for a task.

---

# Skills

---
Describe specific skills that are useful for an agent and how to use them - this will be added into a skills section and is completely optional. Skill names and descriptions will be added here anyways for chosen skills.

---
