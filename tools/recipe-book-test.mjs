import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.PLAY_URL||'http://localhost:5173');
  await page.waitForFunction(()=>!!window.ironwood,{timeout:30000});

  const recipeBook=page.getByRole('region',{name:'Recipe book. Hover or focus to open.'});
  await expect(recipeBook).toHaveCSS('max-height','44px');
  await expect(page.locator('#mission-copy')).toContainText('Hover over the dark-green recipe book at the bottom to open it.');
  await page.screenshot({path:'.context/recipe-book-collapsed.png'});

  await recipeBook.hover();
  await expect(recipeBook).toHaveCSS('max-height','220px');
  await expect(page.getByRole('button',{name:'Build Lumber camp',exact:true})).toBeVisible();
  await page.screenshot({path:'.context/recipe-book-expanded.png'});

  await page.mouse.move(720,400);
  await expect(recipeBook).toHaveCSS('max-height','44px');
  await page.getByRole('tab',{name:'Production',exact:true}).focus();
  await expect(recipeBook).toHaveCSS('max-height','220px');

  await page.getByRole('button',{name:'Field guide',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Hover over the dark-green recipe book at the bottom to reveal its building choices.');
  await page.getByRole('button',{name:'Close dialog'}).click();

  await page.setViewportSize({width:1024,height:768});
  await page.mouse.move(500,350);
  await expect(recipeBook).toHaveCSS('max-height','44px');
  await recipeBook.hover();
  await expect(recipeBook).toHaveCSS('max-height','220px');
  await page.screenshot({path:'.context/recipe-book-1024-expanded.png'});
  assert.deepEqual(errors,[]);
  console.log('RECIPE BOOK CHECKS PASSED: collapsed default, hover reveal at 1440×1000 and 1024×768, keyboard reveal, tutorial copy, and field-guide copy.');
}finally{
  await browser.close();
}
