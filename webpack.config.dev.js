// webpack.config.dev.js (DESARROLLO)
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import HtmlWebpackPlugin from 'html-webpack-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  mode: 'development',
  entry: path.resolve(__dirname, './src/index.js'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',        // sin hash en dev
    publicPath: '/',              // base local correcta
  },
  devtool: 'eval-cheap-module-source-map',
  resolve: {
    extensions: ['.js'],
    alias: {
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@templates': path.resolve(__dirname, 'src/templates'),
      '@styles': path.resolve(__dirname, 'src/styles'),
      '@images': path.resolve(__dirname, 'src/assets/images'),
    },
  },
  module: {
    rules: [
      {
        test: /\.m?js$/,
        exclude: /node_modules/,
        use: 'babel-loader',
      },
      {
        test: /\.(css|styl)$/i,
        // En dev usamos HMR con style-loader
        use: ['style-loader', 'css-loader', 'stylus-loader'],
      },
      {
        test: /\.(png|jpe?g|gif|svg|webp|ico)$/i,
        type: 'asset/resource',
        generator: { filename: 'assets/images/[hash][ext][query]' },
      },
      {
        test: /\.(woff2?|eot|ttf|otf)$/i,
        type: 'asset/resource',
        generator: { filename: 'assets/fonts/[hash][ext][query]' },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      inject: true,
      template: path.resolve(__dirname, './public/index.html'),
      filename: './index.html',
    })
  ],
  devServer: {
    static: { directory: path.resolve(__dirname, 'dist') },
    historyApiFallback: true,
    hot: true,
    open: true,
    compress: true,
    port: 3006,                   // como en tu clase
    client: { overlay: true },
    watchFiles: ['src/**/*', 'public/**/*'],
  },
  // Si corres sin dev-server: mantiene watch en tiempo real
  watch: true,
  watchOptions: { ignored: /node_modules/ },
  optimization: { runtimeChunk: 'single' },
};