import express from "express"
import multer from "multer";
//import {sendMsg, receiveMsg, startSQSPolling} from './sqsConnector.js';
import { EC2Client, RunInstancesCommand, TerminateInstancesCommand } from "@aws-sdk/client-ec2";
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import {start_autoscaling} from './autoscaler.js';

const APP_SQS_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/533266969005/1227953352-req-queue";
const APP_SQS_RECV_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/533266969005/1227953352-resp-queue";


const client = new EC2Client();
const sqs_client = new SQSClient();

const upload = multer({ dest: '.' });
const app = express()
const port = 8000

import * as d3 from "d3";
import fs from "fs";

const csv = fs.readFileSync("./csv_results.csv", "utf8");
const data =d3.csvParse(csv);

const hashMap = new Map();

const runningInstances = [];
let cooldownPeriod = 90000;
let lastScalingAction = 0;

let pendingReqCnt = 0;

for (var i = 0; i < data.length; i++) {
  hashMap.set(data[i].Image, data[i].Results);
}

// console.log(hashMap.size);

// hashMap.forEach((value, key) => {
//   console.log(key + ' = ' + value);
// });


let RESULTS = {};


async function getPendingRequestsFromSQS() {
	try {
		const sqs_input = { // GetQueueAttributesRequest
			QueueUrl: APP_SQS_QUEUE_URL,
			AttributeNames: [ "ApproximateNumberOfMessages" ],
		};
		const sqs_command = new GetQueueAttributesCommand(sqs_input);
		const sqs_response = await sqs_client.send(sqs_command);
		const approximateNumberOfMessages = parseInt(sqs_response.Attributes.ApproximateNumberOfMessages);
		console.log('Approx Num msgs:', approximateNumberOfMessages);
		return approximateNumberOfMessages;
	  } catch (error) {
		console.error('Error getting pending requests from SQS:', error);
		return 0;
	  }
}

const scaleOut = async (targetCount) => {

	try {
		const instancesToLaunch = targetCount - runningInstances.length;
		if(instancesToLaunch > 0) {
			const input = { // RunInstances	Request
				ImageId: "ami-085f4c3fc190c85fd",
				InstanceType: "t2.micro",
				KeyName: "asuto-first-key",
				MaxCount: instancesToLaunch,
				MinCount: instancesToLaunch,
				SecurityGroupIds: [ 
				"sg-0e20d2b8531391245",
				],
				SubnetId: "subnet-099fc0218f77b80de",
			};
			const command = new RunInstancesCommand(input);
			const response = await client.send(command);
			console.log("RunInstancesCommand Response got:")
			console.log(response);
			// runningInstances.push(response.Instances[0].InstanceId);
			const insIds = response.Instances.map(instan => instan.InstanceId);
			runningInstances.push(...insIds);

      		console.log(`New instances launched: ${insIds.join(', ')}`);
			
			console.log(runningInstances);
		}
	} catch (err) {
		console.log('Error Scaling Out:', err);
	}
}

const scaleIn = async (pendingReq) => {
	try {
		if (runningInstances.length > 0 && pendingReq === 0) { 
			const instanceIds = runningInstances.splice(0, runningInstances.length);
			runningInstances.length = 0;
			await instanceIds.map(id => client.send(new TerminateInstancesCommand({ InstanceIds: [id] })));
			console.log(`Instances terminated: ${instanceIds.join(', ')}`);
		}
	} catch (err) {
		console.error('Error scaling in:', err);
	}
}

app.get('/', (req, res) => {
  res.send('GET Requests are not handled in this cloud endpoint!')
})

app.post('/', upload.single('inputFile'), async (req, res) => {

  try {
	const fileName = req.file.originalname;

	//console.log('Got fileName:', fileName);

	if (!req.file) {
	    res.status(400).send('No file uploaded.');
	    return;
	}
	function removeExtension(filename) {
	    return filename.substring(0, filename.lastIndexOf('.'));
	}
	// console.log(removeExtension(fileName));

	let strip_filename = removeExtension(fileName);

	  const new_command = new SendMessageCommand({
		  QueueUrl: APP_SQS_QUEUE_URL,
		  DelaySeconds: 0,
		  MessageBody: req.file.originalname,
	  });

	  const responses = await sqs_client.send(new_command);
	  //console.log("After Sending Msg")
	  const resp = await checkIfResponseIsAvailable(strip_filename);
	  //console.log('Response Ready');
	  if(resp) {
		  res.status(200).send(strip_filename+':'+resp);
	  } else {
		  res.status(500).send('No response received from processing tier');
	  }

	// console.log('app-tier-main curr_msg_id : ', responses.MessageId);

	//  pendingReqCnt = pendingReqCnt+1;
	//   console.log('After Inc PendingReqCnt = ', pendingReqCnt);
	
	// const resp = await receiveMsg(undefined, responses.MessageId);

	// if (resp && resp.length > 0) {
	//   const message = resp[0].Body.split(';')[0];
	//   res.status(200).send(strip_filename + ':' + message);
	// } else {
	//   res.status(500).send('No response received from processing tier');
	// }
	// pendingReqCnt = pendingReqCnt - 1;
	//   console.log('After Dec PendingReqCnt = ', pendingReqCnt);
  } catch (err) {
        console.error('Error:', err);
        res.status(500).send('Internal Server Error');
  }
});

app.listen(8000, () => {
  console.log(`Example app listening on port ${port}`)
})

//startSQSPolling();
//sendMsg(undefined, "Hello!!! This is Asutosh Sender");
//
export const handleAppTierMessages = (mesg) => {
	console.log("Result from the App Tier is:", mesg);
};


async function checkIfResponseIsAvailable(imageFileName) {
    return new Promise(resolve => {
        const interval = setInterval(() => {
	    if (RESULTS[imageFileName]) {
                clearInterval(interval);
                const result = RESULTS[imageFileName];
                delete RESULTS[imageFileName];
                resolve(result);
            }
        }, 500);
    });

    /*while (!(imageFileName in RESULTS)) {
        continue;
    }
    const imageClassifiedNameByTheModel = RESULTS[imageFileName];
    delete RESULTS[imageFileName];
    return imageClassifiedNameByTheModel;*/
}

async function loadResponseIntoResultsDictionary(imageFileName, imageClassifiedNameByTheModel) {
    RESULTS[imageFileName] = imageClassifiedNameByTheModel;
    //console.log('Updated local data store - Results Dictionary');
    //console.log(RESULTS);
}

async function getMessagesFromResponseQueue() {
    while (true) {
        try {
            //console.log("Checking for Messages in the SQS response queue");
            const messageFromTheSqsResponseQueue = await sqs_client.send(new ReceiveMessageCommand({
                QueueUrl: APP_SQS_RECV_QUEUE_URL,
                AttributeNames: ['All'],
                MessageAttributeNames: ['All'],
                MaxNumberOfMessages: 10,
                WaitTimeSeconds: 20
            }));
            if (messageFromTheSqsResponseQueue.Messages) {
                for (const message of messageFromTheSqsResponseQueue.Messages) {
			const body = message.Body;
                    const [respFilename, result] = body.split(',');
                    await loadResponseIntoResultsDictionary(respFilename, result);
                    console.log("File Name: ", respFilename);
                    console.log("Classification Result: ", result);
                    await deleteFromTheSqsResponseQueue(message.ReceiptHandle);
                }
            }
        } catch (error) {
            console.log("Error while consuming message from Response Queue:", error);
        }
    }
}

async function deleteFromTheSqsResponseQueue(sqsResponseMessageReceiptHandle) {
    await sqs_client.send(new DeleteMessageCommand({
        QueueUrl: APP_SQS_RECV_QUEUE_URL,
        ReceiptHandle: sqsResponseMessageReceiptHandle
    }));
}

// Call the function to start consuming messages from the SQS response queue
getMessagesFromResponseQueue().catch(console.error);

start_autoscaling();

// Check for scaling conditions regularly
//setInterval(async () => {
//	console.log("SetInterval Running.")
//	const pendingRequests = await getPendingRequestsFromSQS(); // Implement this function
//	console.log('SetInterval pendingReqCnt = ', pendingReqCnt);	
//  
//	const targetInstanceCount = Math.min(pendingReqCnt, 20); // Target at most 20 instances
//
//	console.log("targetInsCnt = ", targetInstanceCount);
//	console.log("runningInstances.length = ", runningInstances.length);
//	console.log("timestamp is = ",(Date.now() - lastScalingAction));
//
//
//	if (runningInstances.length < 20 && targetInstanceCount > runningInstances.length && ((Date.now() - lastScalingAction) > cooldownPeriod)) {
//	  await scaleOut(targetInstanceCount);
//	  lastScalingAction = Date.now();
//	} else if (targetInstanceCount == 0 && Date.now() - lastScalingAction > cooldownPeriod) {
//	  await scaleIn(pendingRequests);
//	  lastScalingAction = Date.now();
//	}
//}, 8000);
