import {
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SQSClient,
  DeleteMessageBatchCommand,
} from "@aws-sdk/client-sqs";
import {handleWebTierMessages} from './appTierMain.js'


const SQS_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/533266969005/1227953352-req-queue";
const SQS_SEND_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/533266969005/1227953352-resp-queue"

const client = new SQSClient({});

const receiveMessage = (queueUrl) =>
  client.send(
	  new ReceiveMessageCommand({
		  AttributeNames: ['All'],
		  MessageAttributeNames: ['All'],
		  QueueUrl: queueUrl,
	  }),
  );

export const receiveMsg = async (queueUrl = SQS_QUEUE_URL) => {
	const { Messages } = await receiveMessage(queueUrl);

	if (!Messages) {
		return null;
	} else {
		console.log("Got a Message!!!");
		console.log(Messages[0].Body); //Temporary-TBD
		await client.send(
			new DeleteMessageCommand({
				QueueUrl: queueUrl,
				ReceiptHandle: Messages[0].ReceiptHandle,
			}),
		);
		return Messages;
	}
};

export const sendMsg = async (sqsQueueUrl = SQS_SEND_QUEUE_URL, msg) => {
  const command = new SendMessageCommand({
    QueueUrl: sqsQueueUrl,
    DelaySeconds: 0,
    MessageBody: msg,
  });

  const response = await client.send(command);
  console.log("Asutosh Log:",response);
  return response;
};

export const startSQSPolling = () => {
  const interval = setInterval(receiveMsg, 3000);
};
