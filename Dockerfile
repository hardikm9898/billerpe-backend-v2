# Use an official Node.js runtime as a parent image
FROM node:latest

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the container
COPY package*.json ./

# Install app dependencies
RUN npm install -g npm@latest

# Bundle your app's source code inside the Docker image
COPY . .

# Expose the port your app runs on
EXPOSE 4000

# Command to run your application
CMD ["npm", "start"]
