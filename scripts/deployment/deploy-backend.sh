#!/bin/bash

# Backend Deployment Script for PoemsIndia Production Server

echo "🚀 Starting backend deployment..."

# Configuration
SERVER_USER="ubuntu"
SERVER_HOST="13.204.38.128"
SSH_KEY="$HOME/Downloads/LightsailDefaultKey-ap-south-1.pem"
REMOTE_PATH="/home/ubuntu/pi-backend"
LOCAL_PATH="."

echo "📦 Creating deployment package..."

# Create temporary directory
TEMP_DIR=$(mktemp -d)
echo "Using temp directory: $TEMP_DIR"

# Copy all files except node_modules and other excluded files
rsync -av \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'logs' \
  --exclude '*.log' \
  --exclude '.DS_Store' \
  --exclude 'scripts/content-submission-migration-*' \
  --exclude 'scripts/schema-migration-*' \
  . "$TEMP_DIR/"

echo "📤 Uploading to server..."

# Upload files to server
rsync -avz -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
  "$TEMP_DIR/" "$SERVER_USER@$SERVER_HOST:$REMOTE_PATH/"

echo "🔧 Installing dependencies on server..."

# SSH to server and install dependencies, then restart
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_HOST" << 'EOF'
  cd /home/ubuntu/pi-backend
  
  echo "📦 Installing/updating dependencies..."
  npm install --production
  
  echo "⏹️ Stopping backend service..."
  pm2 stop backend
  
  echo "🚀 Starting backend service..."
  pm2 start backend
  
  echo "📊 Service status:"
  pm2 list
  
  echo "📝 Recent logs:"
  pm2 logs backend --lines 5
EOF

# Cleanup
rm -rf "$TEMP_DIR"

echo "✅ Backend deployment completed!"
echo "🌐 Backend should be running on the production server"
echo "📍 Check status: ssh -i $SSH_KEY ubuntu@$SERVER_HOST 'pm2 status'"
