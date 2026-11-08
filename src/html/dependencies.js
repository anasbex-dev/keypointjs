import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadParserDependency(name, installCommand) {
  try {
    return require(name);
  } catch (cause) {
    const error = new Error(
      `KeyPointJS HTML Parser dependency "${name}" is unavailable. ` +
      `Install the optional parser dependencies with: ${installCommand}. ` +
      'The main KeyPointJS package can still be used without them.',
      { cause }
    );
    error.code = 'KEYPOINTJS_HTML_PARSER_DEPENDENCY_MISSING';
    throw error;
  }
}

const installCommand = 'npm install parse5@7.3.0 css-select@5.2.2 css-what@6.2.2';

export const parse5 = loadParserDependency('parse5', installCommand);
export const cssSelect = loadParserDependency('css-select', installCommand);
export const cssWhat = loadParserDependency('css-what', installCommand);
