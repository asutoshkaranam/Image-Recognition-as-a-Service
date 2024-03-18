import {sendMsg, receiveMsg, startSQSPolling} from '/home/ubuntu/asutoshaws/sqsConnector.js';
import { spawnSync } from 'node:child_process';
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from 'fs';

const s3_client = new S3Client({});

export const uploadImgS3bucket = async (inputBucket, imgName, imgPath) => {
  let imageData = "";
  if(inputBucket) {
	imageData = fs.readFileSync(imgPath);
  }
  const command = new PutObjectCommand({
	  Bucket: inputBucket ? "1227953352-in-bucket" : "1227953352-out-bucket",
	  Key: inputBucket ? imgName : imgName.substring(0, imgName.lastIndexOf('.')),
	  Body: inputBucket ? imageData : imgPath,
  });

  try {
    const response = await s3_client.send(command);
    console.log(response);
  } catch (err) {
    console.error(err);
  }
};

export const handleWebTierMessages = async (MsgObj) => {
	console.log("Asutosh LOG App Tier Main : ", MsgObj);

	// RUN THE ML ALGORITHM
	let arg = "/home/ubuntu/asutoshaws/CSE546-Cloud-Computing/dataset/face_images_1000/"+MsgObj[0].Body;
	console.log("Asutosh DBG : ", arg)
	const pyProg = spawnSync('python3', ['/home/ubuntu/asutoshaws/CSE546-Cloud-Computing/model/face_recognition.py', arg]);
	if (pyProg.error) {
		console.error('Error running python script:', result.error);
		return;
	}

	let str = pyProg.stdout.toString();
	str = str.substring(0,str.length-1);
	console.log("Asutosh Classification: ", str);
	
	//SEND THE RESPONSE
	function removeExtension(filename) {
		return filename.substring(0, filename.lastIndexOf('.'));
	}	
	
	let strip_filename = removeExtension(MsgObj[0].Body);
	sendMsg(undefined,strip_filename.concat(",",str));
	uploadImgS3bucket(0, MsgObj[0].Body, str);
	uploadImgS3bucket(1, MsgObj[0].Body, arg);
};


async function main() {
	while (true) {
	  try {
		const recv_msg_obj = await receiveMsg();
		if(recv_msg_obj != null) {
			await handleWebTierMessages(recv_msg_obj);
		}
	  } catch (error) {
		console.error('Error in main loop:', error);
	  }
	}
}
main();
