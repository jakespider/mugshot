const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(cors());

// Helper function for delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: retry page.goto with up to N attempts
async function tryGoto(page, url, options, maxAttempts = 3) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      console.log(`Page load attempt ${attempt}: ${url}`);
      await page.goto(url, options);
      return;
    } catch (err) {
      console.warn(`Page load failed (attempt ${attempt}): ${err.message}`);
      if (attempt >= maxAttempts) throw err;
      await delay(1000); // wait 1 second before retrying
    }
  }
}

app.get('/wakenc', async (req, res) => {
  let browser;
  try {
    const pageNum = parseInt(req.query.page, 10) || 1;
    const url = `https://wakenc.mugshots.zone/2025/07/page/${pageNum}/`;

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

    // Navigate with retry
    console.log(`Navigating to page ${pageNum}: ${url}`);
    await tryGoto(page, url, { waitUntil: 'networkidle2', timeout: 15000 });

    console.log('Waiting for content...');
    try {
      await page.waitForSelector('article', { timeout: 15000 });
    } catch (error) {
      console.warn('Article elements not found within timeout');
    }

    // Handle potential popups
    console.log('Checking for popups...');
    await page.evaluate(() => {
      const popupSelectors = [
        '.popup', '.modal', '#gdpr-modal',
        '.fc-consent-root', '.truste_box_overlay'
      ];
      for (const selector of popupSelectors) {
        const popup = document.querySelector(selector);
        if (popup) {
          const closeBtns = popup.querySelectorAll('button, .close, [title="Close"], [aria-label="Close"]');
          if (closeBtns.length > 0) {
            closeBtns[0].click();
            console.log(`Closed popup using selector: ${selector}`);
            return;
          }
        }
      }
    });

    await delay(2000); // Allow content to load after popups

    // Scrape content
    console.log('Scraping content...');
    const mugshots = await page.evaluate(() => {
      const results = [];
      const articles = document.querySelectorAll('article');

      articles.forEach(article => {
        const imgEl = article.querySelector('.post-image img');
        const titleEl = article.querySelector('.entry-title a');
        const excerptEl = article.querySelector('.entry-summary');

        if (imgEl && titleEl) {
          results.push({
            img: imgEl.src,
            name: titleEl.innerText.trim(),
            crime: excerptEl ? excerptEl.innerText.trim() : 'Charges not specified',
            link: titleEl.href || ''
          });
        }
      });

      return results;
    });

    await browser.close();

    if (mugshots.length === 0) {
      return res.status(404).json({ 
        error: 'No mugshots found',
        debug: 'Check server logs for details',
        page: pageNum
      });
    }

    console.log(`Successfully scraped ${mugshots.length} mugshots from page ${pageNum}`);
    res.json({
      page: pageNum,
      totalPages: 10, // Consider dynamic detection later
      mugshots: mugshots
    });

  } catch (error) {
    console.error('Scraping error:', error);
    if (browser) await browser.close();
    res.status(500).json({ 
      error: 'Scraping failed',
      details: error.message,
      page: req.query.page || 1
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});