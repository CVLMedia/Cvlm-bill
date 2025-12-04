#!/bin/bash

# Script untuk mengecek log webhook dari Tripay
# Usage: ./scripts/check-webhook-logs.sh [invoice_number]

INVOICE_NUMBER=${1:-""}

echo "🔍 Checking Webhook Logs"
echo "========================="
echo ""

if [ -z "$INVOICE_NUMBER" ]; then
    echo "Usage: ./scripts/check-webhook-logs.sh <invoice_number>"
    echo "Contoh: ./scripts/check-webhook-logs.sh INV-202511-6709"
    exit 1
fi

echo "Mencari log untuk invoice: $INVOICE_NUMBER"
echo ""

# Check PM2 logs
if command -v pm2 &> /dev/null; then
    echo "📋 PM2 Logs (terakhir 100 baris):"
    echo "-----------------------------------"
    pm2 logs --lines 100 --nostream | grep -i -E "(webhook|tripay|$INVOICE_NUMBER)" | tail -20
    echo ""
fi

# Check application logs if exists
if [ -f "logs/app.log" ]; then
    echo "📋 Application Logs:"
    echo "-----------------------------------"
    grep -i -E "(webhook|tripay|$INVOICE_NUMBER)" logs/app.log | tail -20
    echo ""
fi

# Check system logs
echo "📋 System Logs (terakhir 50 baris dengan keyword):"
echo "-----------------------------------"
journalctl -u cvlmedia -n 50 --no-pager 2>/dev/null | grep -i -E "(webhook|tripay|$INVOICE_NUMBER)" || echo "System logs tidak tersedia"
echo ""

echo "💡 Tips:"
echo "  1. Cari keyword: [WEBHOOK], [TRIPAY], $INVOICE_NUMBER"
echo "  2. Cek apakah ada error: 'Invalid signature', 'Failed to process', dll"
echo "  3. Cek apakah webhook diterima tapi gagal diproses"
echo ""

