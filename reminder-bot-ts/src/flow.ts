import { Flow } from 'pocketflow'
import { GetQuestionNode, AnswerNode } from './nodes'
import { QASharedStore } from './types'

export function createQaFlow(): Flow {
  // Create nodes
  const getQuestionNode = new GetQuestionNode()
  const answerNode = new AnswerNode()

  // Connect nodes in sequence
  getQuestionNode.next(answerNode)

  // Create flow starting with input node
  return new Flow<QASharedStore>(getQuestionNode)
}
