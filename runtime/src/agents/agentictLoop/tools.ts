export const SUBMIT_RESULT_SCHEMA = {
  name: 'submit_result',
  description:
    'REQUIRED to end the session. Call this tool when all tasks are done to deliver the final result to the user. This is the only valid way to finish — do NOT respond with plain text as a final reply. Put the complete summary of what was done (or the answer to the user\'s question/task) into the `result` field.\nIf you solved user\'s task/question and there is nothing to do anymore - call this tool immediately instead of asking user',
  parameters: {
    type: 'object',
    properties: {
      result: {
        type: 'string',
        description: 'The final result or answer as a markdown string',
      },
    },
    required: ['result'],
  },
};
