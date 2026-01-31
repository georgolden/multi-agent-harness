import 'dotenv/config'
import { createQaFlow } from './flow'
import { QASharedStore } from './types'

// Example main function
async function main(): Promise<void> {
  const shared: QASharedStore = {
    question: undefined, // Will be populated by GetQuestionNode from user input
    answer: undefined, // Will be populated by AnswerNode
  }

  // Create the flow and run it
  const qaFlow = createQaFlow()
  await qaFlow.run(shared)
  console.log(`Question: ${shared.question}`)
  console.log(`Answer: ${shared.answer}`)
}

// Run the main function
main().catch(console.error)
