import { Item } from 'rss-parser';
import puppeteer from 'puppeteer';
import { TitleError, IdError, HostError } from '../../domain';
import { cookieClicker } from '../web/cookieClicker';

export const validateArticle = async (article: Item, medium: MediumDefinition, feedname: string): Promise<{hostError?: HostError, titleError?: TitleError, idError?: IdError}> => {
  if (!article) {
    return Promise.resolve({});
  }

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.setViewport({
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false
  });

  const link: string | undefined = article.link || article.guid || undefined;

  // Verify host can be reached
  // Host errors preclude any further checks so we can return early
  try {
    if (!link) {
      return {
        hostError: {
          message: `Could not connect to [${article.link as string}]: no link or GUID in article`,
          article,
          medium,
          feedname
        }
      }
    }

    const response = await page.goto(link);
    const statusCode = await response?.status();
  
    if (statusCode) {
      if (statusCode >= 400) {
        await browser.close();
        return {
          hostError: {
            message: `Could not connect to [${link}]: server returned ${statusCode}`,
            article,
            medium,
            feedname
          }
        }
      }
    }
  } catch (err) {
    return {
      hostError: {
        message: `Could not connect to [${link}]: \n${err}`,
        article,
        medium,
        feedname
      }
    }
  }

  // Verify the cookie wall can be bypassed
  try {
    await cookieClicker(page, medium);
  } catch (error) {
    return {
      hostError: {
        message: `Could not connect to [${link}]: cookie wall could not be dismissed.`,
        article,
        medium,
        feedname
      }
    }
  }

  let titleError: TitleError | undefined = undefined;
  let idError: IdError | undefined  = undefined;

  // Verify page has accessible ID
  const url = await page.url();

  switch (medium.page_id_location) {
    case ('var'): {
      try {
        const id = await page.evaluate((medium: MediumDefinition) => {
          return new Promise((resolve) => {
            let out: any = window;
            const locations = medium.page_id_query.split('.');
            locations.forEach(location => {
              out = out[location];
            });

            resolve(out);
          });
        });
        if (!id) {
          idError = {
            message: `No match for ID on [${url}] using path to window variable [${medium.page_id_query}]`,
            article,
            medium,
            feedname
          }
        }
      } catch (err) {
        // Most likely a type error because the path to var is broken
        idError = {
          message: `No match for ID on [${url}] using path to window variable [${medium.page_id_query}]`,
          article,
          medium,
          feedname
        }
      }
      break;
    };
    case ('url'): {
      if (!url.match(medium.id_mask)) {
        idError = {
          message: `No match for ID in [${url}] using mask [${medium.id_mask}]`,
          article,
          medium,
          feedname
        }
      }
      break;
    }
  }

  // Verify title is present on page and matches that from the RSS feed
  const titleElement = await page.$(medium.title_query);
  if (!titleElement) {
    titleError = {
      message: `Title element could not be found on [${url}] using selector [${medium.title_query}]`,
      article,
      medium,
      feedname
    }
  } else {
    // Skipping this test for now, it's very inconsistent
    //
    // const text = await page.evaluate(titleElement => titleElement.textContent, titleElement);
    // if (text.trim() !== article.title?.trim()) {
    //   titleError = {
    //     message: `Title on page [${text}] did not match title from RSS feed [${article.title}]`,
    //     article,
    //     medium,
    //     feedname
    //   }
    // }
  }

  await browser.close();

  return {
    titleError,
    idError
  }
}