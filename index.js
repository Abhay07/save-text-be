const fs = require('fs');
const AWS = require('aws-sdk');
var fsPath = require('fs-path');
const jwt = require('jsonwebtoken');
const config = require('./config');
const pathModule = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const MongoClient = require('mongodb').MongoClient;
const cors = require('cors');
AWS.config.update(config.awsSecret);
const s3 = new AWS.S3();

let db;
const s3Bucket = 'save-text1';
const app = express()
app.use(cors())
const whitelist = ['http://localhost:8080','https://cedriclajoiewow.com','http://cedriclajoiewow.com']
const corsOptions = {
  origin: function (origin, callback) {
    if (whitelist.indexOf(origin) !== -1) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  }
}


MongoClient.connect('mongodb://abhay07:abhay0707@ds127864.mlab.com:27864/cedfilesystem',(err,database)=>{
	if(err){
		console.log('DB cannot be connected');
		return;
	}
	db = database.db('cedfilesystem');
	console.log('port is '+process.env.PORT);
	app.listen(process.env.PORT || 8084, () => console.log('Example app listening on port 8084!'))
})


app.use(function (err, req, res, next) {
  res.status(500).send('Something broke!')
})

app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({extended:true}))

const checkAuth = (req,res,next)=>{
	const token = req.headers['access-token'];
	if(!token) return res.status(401).send('User not authrized');
	jwt.verify(token,config.secret,(err,decoded)=>{
		if(err) return res.status(401).send('User not authorized');
		db.collection('users').findOne({"_id":decoded.id},(err,results)=>{
			if (err) return res.status(500).send('User not found');
			if(!results) return res.status(500).send('User not found');
			req.user = results;
			next();
		})
	})
}

const getSequenceNumber = (id) =>{
	return new Promise((resolve,reject)=>{
		db.collection('counters',(err,counters)=>{
			if(err){
				reject(err);
				return;
			}
			counters.insertOne({_id:id,sequence_value:0}, (err,res)=>{
				counters.findOneAndUpdate(
					{_id: id },
					{$inc:{sequence_value:1}},
					{returnOriginal:false},
					(err,result)=>{
						if(err){
							reject(err);
							return;
						}
						resolve(result.value.sequence_value);
					}
				);
			});
		});
   }) 
   
}



app.post('/register',checkAuth,(req,res,next)=>{
	const role = req.user.role;
	const username = req.body.username;
	const password = req.body.password;
	const name = req.body.name;
	if(!username || !password || !name){
		res.status(422).send('Invalid info');
		return;
	}
	if(role !== 'admin'){
		return res.status(401).send('Unauthorized');
	}
	const usersDb = db.collection('users');
	getSequenceNumber('tid').then((id)=>{
		usersDb.findOne({username:username},(err,results)=>{
			if(results){
				res.status(422);
				res.send('User already exists');
				return;
			}
			usersDb.insert({
				username:username,
				password:password,
				name:name,
				_id:id,
				role:'user'
			},(err,result)=>{
				if(err) return console.log(err);
				res.send('User created successfully');
			})				
		})
	})
	.catch((err)=>{
		next(err);
	})
	


})

app.post('/login',(req,res)=>{
	const username = req.body.username;
	const password = req.body.password;
	if(!username || !password) return res.status(401).send('User not authorized');

	db.collection('users').findOne({username:username,password:password},(err,results)=>{
		if(err || !results) return res.status(401).send('User not authorized');
		const token = jwt.sign({id:results._id},config.secret,{
			expiresIn:86400
		})
		res.send({auth:true,token:token});
	})
	
})

app.get('/users',checkAuth,(req,res,next)=>{
	const role = req.user.role;
	if(role !== 'admin'){
		return res.status(401).send('User not authorized');
	}
	const usersDb = db.collection('users');
	usersDb.find({},{
		projection:{_id:0}
	}).toArray((err,result)=>{
		if(err) return next(err);
		res.send({users:result});
	});
})

app.get('/folderStructure',checkAuth,(req,res,next)=>{
	const userId = req.user._id;
	const name = req.user.name;
	const folderCollection = db.collection('folderStructure');
	folderCollection.findOne({userId:Number(userId)},{
		projection:{userId:0,_id:0}
	},(err,result)=>{
		if(err) return next(err);
		if(!result) return res.send({name:name});
		result.name = name;
		res.send(result);
	});
})

app.post('/folderStructure',checkAuth,(req,res,next)=>{
	const userId = req.user._id;
	const folderStructure = req.body.folderStructure;
	const folderCollection = db.collection('folderStructure');
	folderCollection.findOneAndUpdate(
	{
		userId:userId
	},
	{$set:{folderStructure:folderStructure}},
	{upsert:true},
	(err,result)=>{
			if(err){
				return next(err);
			}
			res.send('Saved successfully');
	})
})

app.get('/getFile',checkAuth,(req,res,next)=>{
	const filePath = req.user._id+'/'+req.query.file;
	s3.getObject({
	Bucket: s3Bucket,
	Key: filePath
	},function (err,resp) {
		if(err || !resp.Body) {
			return res.status(404).send('Error')
		}
		return res.send(resp.Body.toString('utf-8'))
	});

})

app.post('/saveFiles',checkAuth,(req,res,next)=>{
	const files = req.body.files;
	files.forEach((file,ind)=>{
		const filePath = req.user._id+'/'+file.path;
		const content = file.content;
		s3.putObject({
		  Bucket: s3Bucket,
		  Key: filePath,
		  Body: content
		},function (err,resp) {
		  if(err){
		  	return res.status(500).send('Not Saved');
		  }
		  if(ind === files.length - 1){
		  	res.send('files saved successfully')
		  }
		});
	})
	
})

app.post('/deleteFiles',checkAuth,(req,res,next)=>{
	const files = req.body.files;
	files.forEach((file,ind)=>{
		const filePath = req.user._id+'/'+file.path;
		fs.unlink(filePath,(err)=>{
			if(err){
				next(err);
				return;
			}
			if(ind === files.length -1){
				res.send('File Deleted successfully');
			}
		})
	})
		
})