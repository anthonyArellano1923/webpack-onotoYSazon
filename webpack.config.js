// webpack.config.js (PRODUCCIÓN)
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plugins
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';
import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------------------------------------------------

export default {
  mode: 'production',
  entry: path.resolve(__dirname, './src/js/index.js'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash].js',
    publicPath: 'auto', // Para GitHub Pages (ajusta si cambias de repo)
    assetModuleFilename: 'assets/[name][hash][ext][query]',
    clean: true,
  },
  devtool: 'source-map',
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
        // Transpilación JS como en el ejemplo
        test: /\.m?js$/,
        exclude: /node_modules/,
        use: 'babel-loader',
      },
      {
        // CSS/Stylus extraído en archivos separados
        test: /\.(css|styl)$/i,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'stylus-loader'],
      },
      {
        // Imágenes
        test: /\.(png|jpe?g|gif|svg|webp|ico)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/images/[hash][ext][query]',
        },
      },
      {
        // Fuentes
        test: /\.(woff2?|eot|ttf|otf)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/fonts/[hash][ext][query]',
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      inject: true,
      template: path.resolve(__dirname, './public/index.html'),
      filename: './index.html',
    }),
    new MiniCssExtractPlugin({
      filename: 'assets/[name].[contenthash].css',
    }),
    new CleanWebpackPlugin(),
    // Mantengo tu copia de .nojekyll para GitHub Pages
    new CopyWebpackPlugin({
      patterns: [{ from: 'public/.nojekyll', to: '.' }],
    }),
  ],
  optimization: {
    minimize: true,
    minimizer: [new CssMinimizerPlugin(), new TerserPlugin()],
    runtimeChunk: 'single',
  },
};