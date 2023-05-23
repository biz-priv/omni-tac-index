# omni-tac-index

### Steps to Deploy
#### Build and Deploy Image to ECR (Currently Manual deployment for docker build and push)
* aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 332281781429.dkr.ecr.us-east-1.amazonaws.com
* cd omni-tac-index-ecr
* docker build --platform linux/amd64 -t omni-tac-index-dev:latest .
* docker image ls
* docker tag omni-tac-index-dev:latest 332281781429.dkr.ecr.us-east-1.amazonaws.com/omni-tac-index-dev:latest
* docker push 332281781429.dkr.ecr.us-east-1.amazonaws.com/omni-tac-index-dev:latest


#### Package dependencies 
* npm i serverless
* npm i
* cd lib/nodejs
* npm i

#### Deployment instructions 
* sls deploy -s <stage>
