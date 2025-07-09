import path from 'path';
import { fileURLToPath } from 'url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';

const mode = process.env.NODE_ENV || 'development';
const isProduction = mode === 'production';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  mode,
  entry: './src/js/index.js',
  output: {
    filename: isProduction ? '[name].[contenthash].js' : '[name].js',
    path: path.resolve(__dirname, 'dist'),
    // PublicPath dinámico: para desarrollo local usar '/', para GitHub Pages usar '/webpack-onotoYSazon/'
    publicPath: isProduction ? '/webpack-onotoYSazon/' : '/',
    clean: true,
  },
  devtool: mode === 'development' ? 'inline-source-map' : false,
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: [
          isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
          'css-loader',
        ],
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'images/[name][ext]'
        }
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
      filename: 'index.html',
    }),
    ...(isProduction ? [
      new MiniCssExtractPlugin({
        filename: '[name].[contenthash].css',
      }),
    ] : []),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'public/.nojekyll', to: '.' },
        // Si tienes otros archivos estáticos en public, cópialos también
        // { from: 'public/favicon.ico', to: '.' },
      ],
    }),
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist'),
    },
    port: 8080,
    open: true,
    hot: true,
    // Importante: esto ayuda con el routing en desarrollo
    historyApiFallback: true,
  },
  // Resolver extensiones automáticamente
  resolve: {
    extensions: ['.js', '.css'],
  },
};