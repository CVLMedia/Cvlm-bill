#!/bin/bash

# Script Setup Telegram Bot untuk Monitoring
# CVL Media Billing System
# Usage: ./scripts/setup-telegram-bot.sh

echo "=========================================="
echo "  Telegram Bot Setup untuk Monitoring"
echo "  CVL Media Billing System"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if node-telegram-bot-api is installed
echo -e "${YELLOW}[1/5] Checking dependencies...${NC}"
if npm list node-telegram-bot-api > /dev/null 2>&1; then
    echo -e "${GREEN}✓ node-telegram-bot-api already installed${NC}"
else
    echo -e "${YELLOW}Installing node-telegram-bot-api...${NC}"
    npm install node-telegram-bot-api --save
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ node-telegram-bot-api installed successfully${NC}"
    else
        echo -e "${RED}✗ Failed to install node-telegram-bot-api${NC}"
        exit 1
    fi
fi

echo ""

# Check settings.json exists
echo -e "${YELLOW}[2/5] Checking settings.json...${NC}"
if [ ! -f "settings.json" ]; then
    echo -e "${YELLOW}settings.json not found. Creating from template...${NC}"
    if [ -f "settings.server.template.json" ]; then
        cp settings.server.template.json settings.json
        echo -e "${GREEN}✓ settings.json created from template${NC}"
    else
        echo -e "${RED}✗ settings.server.template.json not found${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ settings.json exists${NC}"
fi

echo ""

# Check if telegram_bot_token is configured
echo -e "${YELLOW}[3/5] Checking Telegram Bot configuration...${NC}"
if grep -q "telegram_bot_token" settings.json && ! grep -q '"telegram_bot_token": ""' settings.json && ! grep -q '"telegram_bot_token": null' settings.json; then
    echo -e "${GREEN}✓ Telegram Bot Token is configured${NC}"
else
    echo -e "${YELLOW}⚠ Telegram Bot Token is not configured${NC}"
    echo ""
    echo "Please configure Telegram Bot Token:"
    echo "1. Get Bot Token from @BotFather on Telegram"
    echo "2. Add to settings.json:"
    echo '   "telegram_bot_token": "YOUR_BOT_TOKEN_HERE"'
    echo '   "telegram_monitoring_enabled": true'
    echo ""
    read -p "Do you want to configure it now? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter your Telegram Bot Token: " BOT_TOKEN
        # Use node to update JSON properly
        node -e "
        const fs = require('fs');
        const settings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
        settings.telegram_bot_token = '$BOT_TOKEN';
        settings.telegram_monitoring_enabled = true;
        fs.writeFileSync('settings.json', JSON.stringify(settings, null, 2));
        console.log('✓ Telegram Bot Token configured');
        "
    fi
fi

echo ""

# Check data directory
echo -e "${YELLOW}[4/5] Checking data directory...${NC}"
if [ ! -d "data" ]; then
    mkdir -p data
    echo -e "${GREEN}✓ data directory created${NC}"
else
    echo -e "${GREEN}✓ data directory exists${NC}"
fi

# Set permissions
chmod 755 data
echo -e "${GREEN}✓ Permissions set${NC}"

echo ""

# Final instructions
echo -e "${YELLOW}[5/5] Setup Summary${NC}"
echo ""
echo -e "${GREEN}✓ Dependencies checked${NC}"
echo -e "${GREEN}✓ Configuration checked${NC}"
echo ""
echo "=========================================="
echo "  Next Steps:"
echo "=========================================="
echo ""
echo "1. Restart the application:"
echo "   pm2 restart cvlmedia"
echo "   (or: npm start)"
echo ""
echo "2. Open Telegram and find your bot"
echo ""
echo "3. Send /start command to register your chat ID"
echo ""
echo "4. Verify with /status command"
echo ""
echo "5. Test with PPPoE login/logout"
echo ""
echo "=========================================="
echo -e "${GREEN}Setup completed!${NC}"
echo "=========================================="

