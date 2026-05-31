FROM node:18

# Install Python and pip
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

# Install pikepdf
RUN pip3 install pikepdf --break-system-packages

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p uploads

EXPOSE 3000

CMD ["node", "server.js"]
