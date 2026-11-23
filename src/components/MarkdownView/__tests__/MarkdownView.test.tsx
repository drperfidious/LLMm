import React from 'react';
import {Linking, ScrollView} from 'react-native';

// Use the project's custom render which mounts MarkdownProvider — required
// because MarkdownView now relies on the ambient TRenderEngineProvider
// instead of building its own engine per instance.
import {render, fireEvent} from '../../../../jest/test-utils';

import {MarkdownView} from '../MarkdownView';

describe('MarkdownView Component', () => {
  it('renders markdown content correctly', () => {
    const markdownText = 'Hello **World**';
    const {getByText} = render(
      <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
    );

    expect(getByText('Hello World')).toBeTruthy();
  });

  it('handles different content widths properly', () => {
    const markdownText = '# Test Markdown';
    const {getByTestId, rerender} = render(
      <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
    );

    // Simulate a layout change
    fireEvent(getByTestId('markdown-content'), 'layout', {
      nativeEvent: {
        layout: {width: 200, height: 100},
      },
    });

    rerender(
      <MarkdownView markdownText={markdownText} maxMessageWidth={200} />,
    );

    const element = getByTestId('markdown-content');

    // Check if style is an array and extract maxWidth from the correct location
    const style = element.props.style;
    let maxWidth: number | undefined;

    if (Array.isArray(style)) {
      // Find maxWidth in the style array
      for (const styleItem of style) {
        if (
          styleItem &&
          typeof styleItem === 'object' &&
          'maxWidth' in styleItem
        ) {
          maxWidth = styleItem.maxWidth;
          break;
        }
      }
    } else if (style && typeof style === 'object' && 'maxWidth' in style) {
      maxWidth = style.maxWidth;
    }

    expect(maxWidth).toBe(200);
  });

  it('does not render main content when markdownText is empty', () => {
    const {getByTestId, queryByText} = render(
      <MarkdownView markdownText="" maxMessageWidth={300} />,
    );

    // Container should still exist
    expect(getByTestId('markdown-content')).toBeTruthy();
    // But no text content should be rendered
    expect(queryByText(/.+/)).toBeNull();
  });

  it('does not render main content when markdownText is whitespace only', () => {
    const {getByTestId, queryByText} = render(
      <MarkdownView markdownText="   " maxMessageWidth={300} />,
    );

    expect(getByTestId('markdown-content')).toBeTruthy();
    expect(queryByText(/.+/)).toBeNull();
  });

  it('renders with selectable text when selectable prop is true', () => {
    const markdownText = 'Selectable text';
    const {getByText} = render(
      <MarkdownView
        markdownText={markdownText}
        maxMessageWidth={300}
        selectable={true}
      />,
    );

    expect(getByText('Selectable text')).toBeTruthy();
  });

  it('renders code blocks with syntax highlighting', () => {
    const markdownText = '```javascript\nconst x = 1;\n```';
    const {getByText} = render(
      <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
    );

    // CodeHighlighter mock renders content as Text
    expect(getByText('const x = 1;')).toBeTruthy();
  });

  it('renders inline code without code block styling', () => {
    const markdownText = 'Use `console.log` for debugging';
    const {getByText} = render(
      <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
    );

    expect(getByText(/console\.log/)).toBeTruthy();
  });

  it('renders common LLM markdown structures', () => {
    const markdownText = [
      '## Plan',
      '- Parse **markdown**',
      '- Preserve `inline code`',
      '',
      '> Keep formatting readable.',
      '',
      'Line one',
      'Line two',
    ].join('\n');
    const {getByText} = render(
      <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
    );

    expect(getByText('Plan')).toBeTruthy();
    expect(getByText('markdown')).toBeTruthy();
    expect(getByText(/inline code/)).toBeTruthy();
    expect(getByText('Keep formatting readable.')).toBeTruthy();
    expect(getByText(/Line one/)).toBeTruthy();
    expect(getByText(/Line two/)).toBeTruthy();
  });

  it('renders inline math without markdown emphasis corruption', () => {
    const {getByText, getAllByTestId, queryByText} = render(
      <MarkdownView
        markdownText="Use $E = mc^2$ and $a_i = b_i + c_i$."
        maxMessageWidth={300}
      />,
    );

    expect(getAllByTestId('markdown-inline-math')).toHaveLength(2);
    expect(getByText('E = mc²')).toBeTruthy();
    expect(getByText('a_i = b_i + c_i')).toBeTruthy();
    expect(queryByText('$E = mc^2$')).toBeNull();
  });

  it('renders display math as a dedicated block', () => {
    const equation = '\\\\frac{1}{n} \\\\sum_{i=1}^{n} x_i';
    const {getByText, getByTestId} = render(
      <MarkdownView
        markdownText={`Before\n\n$$\n${equation}\n$$\n\nAfter`}
        maxMessageWidth={300}
      />,
    );

    expect(getByTestId('markdown-block-math')).toBeTruthy();
    expect(getByText(/1⁄n/)).toBeTruthy();
    expect(getByText(/Σ/)).toBeTruthy();
    expect(getByText('Before')).toBeTruthy();
    expect(getByText('After')).toBeTruthy();
  });

  it('renders bare LaTeX equation lines as readable display math', () => {
    const equation =
      '\\pi = 4 \\left(1 - \\frac{1}{3} + \\frac{1}{5} - \\frac{1}{7} + \\cdots\\right)';
    const {getByText, getByTestId, queryByText} = render(
      <MarkdownView
        markdownText={`Leibniz Formula\n\n${equation}\n\nNot efficient for high precision.`}
        maxMessageWidth={300}
      />,
    );

    expect(getByTestId('markdown-block-math')).toBeTruthy();
    expect(getByText('π = 4(1 - 1⁄3 + 1⁄5 - 1⁄7 + ⋯)')).toBeTruthy();
    expect(queryByText(equation)).toBeNull();
    expect(getByText('Leibniz Formula')).toBeTruthy();
    expect(getByText('Not efficient for high precision.')).toBeTruthy();
  });

  it('renders parenthesized LaTeX inline math delimiters', () => {
    const {getByText, getByTestId, queryByText} = render(
      <MarkdownView
        markdownText={'The identity is \\(a^2 + b^2 = c^2\\).'}
        maxMessageWidth={300}
      />,
    );

    expect(getByTestId('markdown-inline-math')).toBeTruthy();
    expect(getByText('a² + b² = c²')).toBeTruthy();
    expect(queryByText(/\\\(a\^2/)).toBeNull();
  });

  it('renders bracketed LaTeX display math delimiters', () => {
    const equation = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}';
    const {getByText, getByTestId} = render(
      <MarkdownView
        markdownText={`Before\n\n\\[\n${equation}\n\\]\n\nAfter`}
        maxMessageWidth={300}
      />,
    );

    expect(getByTestId('markdown-block-math')).toBeTruthy();
    expect(getByText('x = (-b ± √(b² - 4ac))⁄2a')).toBeTruthy();
    expect(getByText('Before')).toBeTruthy();
    expect(getByText('After')).toBeTruthy();
  });

  it('renders LaTeX equation environments as display math blocks', () => {
    const equation = 'a &= b + c';
    const {getByText, getByTestId} = render(
      <MarkdownView
        markdownText={`\\begin{align}\n${equation}\n\\end{align}`}
        maxMessageWidth={300}
      />,
    );

    expect(getByTestId('markdown-block-math')).toBeTruthy();
    expect(getByText('a = b + c')).toBeTruthy();
  });

  it('does not convert dollar signs inside code spans or code blocks', () => {
    const {getByText, queryByTestId} = render(
      <MarkdownView
        markdownText={'Inline `$PATH` and fenced:\n\n```sh\necho "$HOME"\n```'}
        maxMessageWidth={300}
      />,
    );

    expect(queryByTestId('markdown-inline-math')).toBeNull();
    expect(getByText(/\$PATH/)).toBeTruthy();
    expect(getByText('echo "$HOME"')).toBeTruthy();
  });

  it('opens markdown links through the native linker', () => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined as never);
    const {getByText} = render(
      <MarkdownView
        markdownText="[Docs](https://example.com/docs)"
        maxMessageWidth={300}
      />,
    );

    fireEvent.press(getByText('Docs'));

    expect(openURL).toHaveBeenCalledWith('https://example.com/docs');
    openURL.mockRestore();
  });

  describe('Table Rendering', () => {
    it('renders markdown table with headers and data cells', () => {
      const markdownText =
        '| Name | Value |\n|------|-------|\n| A | 1 |\n| B | 2 |';
      const {getByText} = render(
        <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
      );

      // Verify header cells are rendered
      expect(getByText('Name')).toBeTruthy();
      expect(getByText('Value')).toBeTruthy();

      // Verify data cells are rendered
      expect(getByText('A')).toBeTruthy();
      expect(getByText('1')).toBeTruthy();
      expect(getByText('B')).toBeTruthy();
      expect(getByText('2')).toBeTruthy();
    });

    it('renders table alongside other markdown content', () => {
      const markdownText =
        '# Title\n\nSome text\n\n| Col1 | Col2 |\n|------|------|\n| X | Y |\n\nMore text';
      const {getByText} = render(
        <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
      );

      expect(getByText('Title')).toBeTruthy();
      expect(getByText('Some text')).toBeTruthy();
      expect(getByText('Col1')).toBeTruthy();
      expect(getByText('X')).toBeTruthy();
      expect(getByText('More text')).toBeTruthy();
    });

    it('renders a table with empty cells', () => {
      const markdownText = '| A | B |\n|---|---|\n|   | 1 |\n| 2 |   |';
      const {getByText} = render(
        <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
      );

      expect(getByText('A')).toBeTruthy();
      expect(getByText('B')).toBeTruthy();
      expect(getByText('1')).toBeTruthy();
      expect(getByText('2')).toBeTruthy();
    });

    it('wraps table in a horizontal ScrollView', () => {
      const markdownText = '| A | B |\n|---|---|\n| 1 | 2 |';
      const {UNSAFE_getByType} = render(
        <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
      );

      expect(UNSAFE_getByType(ScrollView)).toBeTruthy();
    });

    it('renders a table with many columns', () => {
      const markdownText =
        '| C1 | C2 | C3 | C4 | C5 |\n|---|---|---|---|---|\n| a | b | c | d | e |';
      const {getByText} = render(
        <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
      );

      expect(getByText('C1')).toBeTruthy();
      expect(getByText('C5')).toBeTruthy();
      expect(getByText('a')).toBeTruthy();
      expect(getByText('e')).toBeTruthy();
    });

    it('renders a table with a single column', () => {
      const markdownText = '| Item |\n|------|\n| One |\n| Two |';
      const {getByText} = render(
        <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
      );

      expect(getByText('Item')).toBeTruthy();
      expect(getByText('One')).toBeTruthy();
      expect(getByText('Two')).toBeTruthy();
    });

    it('renders multiple tables in one message', () => {
      const markdownText =
        '| A | B |\n|---|---|\n| 1 | 2 |\n\nSome text\n\n| X | Y |\n|---|---|\n| 3 | 4 |';
      const {getByText, UNSAFE_getAllByType} = render(
        <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
      );

      expect(getByText('A')).toBeTruthy();
      expect(getByText('X')).toBeTruthy();
      expect(getByText('Some text')).toBeTruthy();

      // Both tables should be wrapped in ScrollViews
      const scrollViews = UNSAFE_getAllByType(ScrollView);
      expect(scrollViews.length).toBeGreaterThanOrEqual(2);
    });

    it('renders a table with many rows', () => {
      const rows = Array.from(
        {length: 10},
        (_, i) => `| item${i} | val${i} |`,
      ).join('\n');
      const markdownText = `| Name | Value |\n|------|-------|\n${rows}`;
      const {getByText} = render(
        <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
      );

      expect(getByText('item0')).toBeTruthy();
      expect(getByText('item9')).toBeTruthy();
      expect(getByText('val0')).toBeTruthy();
      expect(getByText('val9')).toBeTruthy();
    });

    it('renders a table with inline bold and italic formatting in cells', () => {
      const markdownText =
        '| Feature | Status |\n|---------|--------|\n| **Bold** | *Italic* |';
      const {getByText} = render(
        <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
      );

      expect(getByText('Feature')).toBeTruthy();
      expect(getByText('Status')).toBeTruthy();
      expect(getByText('Bold')).toBeTruthy();
      expect(getByText('Italic')).toBeTruthy();
    });
  });

  describe('React.memo behavior', () => {
    it('does not re-render when props are unchanged', () => {
      const markdownText = 'Hello';
      const {getByText, rerender} = render(
        <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
      );

      expect(getByText('Hello')).toBeTruthy();

      // Re-render with same props -- React.memo should prevent re-render
      rerender(
        <MarkdownView markdownText={markdownText} maxMessageWidth={300} />,
      );

      expect(getByText('Hello')).toBeTruthy();
    });

    it('re-renders when markdownText changes', () => {
      const {getByText, rerender} = render(
        <MarkdownView markdownText="First" maxMessageWidth={300} />,
      );

      expect(getByText('First')).toBeTruthy();

      rerender(<MarkdownView markdownText="Second" maxMessageWidth={300} />);

      expect(getByText('Second')).toBeTruthy();
    });
  });
});
