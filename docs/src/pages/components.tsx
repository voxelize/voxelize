import React from "react";

import Layout from "@theme/Layout";

export default () => {
  return (
    <Layout title="Components" description="Hello React Page">
      <div className="p-12">
        <h1>Heading 1</h1>
        <h2>Heading 2</h2>
        <h3>Heading 3</h3>
        <h4>Heading 4</h4>
        <h5>Heading 5</h5>
        <h6>Heading 6</h6>
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed
          condimentum, nisl eget aliquam tincidunt, nunc elit aliquam massa, nec
          luctus nunc lorem eget dolor. Nulla facilisi. Nulla facilisi. Nulla
          facilisi. Nulla facilisi. Nulla facilisi. Nulla facilisi. Nulla Lorem
          ipsum dolor sit amet, consectetur adipiscing elit. Sed condimentum,
          nisl eget aliquam tincidunt, nunc elit aliquam massa, nec luctus nunc
          lorem eget dolor. Nulla facilisi. Nulla facilisi. Nulla facilisi.
          Nulla facilisi. Nulla facilisi. Nulla facilisi. Nulla Lorem ipsum
          dolor sit amet, consectetur adipiscing elit. Sed condimentum, nisl
          eget aliquam tincidunt, nunc elit aliquam massa, nec luctus nunc
          lorem.
        </p>
        <a href="https://www.google.com">Link</a>
        <ul>
          <li>Unordered List Item</li>
          <li>Unordered List Item</li>
          <li>Unordered List Item</li>
        </ul>
        <ol>
          <li>Ordered List Item</li>
          <li>Ordered List Item</li>
          <li>Ordered List Item</li>
        </ol>
        <blockquote>Blockquote</blockquote>
        <pre>Preformatted Text</pre>
        <code>Inline Code</code>
        <hr />
        <table>
          <thead>
            <tr>
              <th>Table Header</th>
              <th>Table Header</th>
              <th>Table Header</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Table Cell</td>
              <td>Table Cell</td>
              <td>Table Cell</td>
            </tr>
            <tr>
              <td>Table Cell</td>
              <td>Table Cell</td>
              <td>Table Cell</td>
            </tr>
            <tr>
              <td>Table Cell</td>

              <td>Table Cell</td>
              <td>Table Cell</td>
            </tr>
          </tbody>
        </table>
        <button>Button</button>
      </div>
    </Layout>
  );
};
